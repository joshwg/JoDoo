import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { APP_NAME, APP_VERSION, BUILD_DATE, COPYRIGHT } from '../appInfo';
import * as db from '../db';
import { subscribeRemoteUpdate } from '../remoteUpdates';
import { createShare, fetchShare, shareExists } from '../syncClient';
import {
  pushShoppingIfShared,
  refreshSyncConnections,
  SHOPPING_SHARE_KEY_SETTING,
} from '../syncManager';
import { headerFontSize, useTextSettings } from '../textSettings';
import { DictionaryEntry, ShoppingItem } from '../types';
import DictionaryModal from './DictionaryModal';
import EnterKeyModal from './EnterKeyModal';
import FontSettingsModal from './FontSettingsModal';
import ServerSettingsModal from './ServerSettingsModal';
import ShareKeyModal from './ShareKeyModal';

export default function ShoppingSection() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [suggestions, setSuggestions] = useState<DictionaryEntry[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [joinVisible, setJoinVisible] = useState(false);
  const [serverSettingsVisible, setServerSettingsVisible] = useState(false);
  const [fontSettingsVisible, setFontSettingsVisible] = useState(false);
  const [shareKeyShown, setShareKeyShown] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [editingAmountItem, setEditingAmountItem] = useState<ShoppingItem | null>(null);
  const [amountText, setAmountText] = useState('');
  const { fontFamily, fontSize, scale } = useTextSettings();

  const refresh = useCallback(() => setItems(db.getShoppingItems()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live-refresh when another peer updates the shared shopping list.
  useEffect(
    () =>
      subscribeRemoteUpdate((target) => {
        if (target.type === 'shopping') refresh();
      }),
    [refresh]
  );

  const changeInput = (text: string) => {
    setNewItem(text);
    setSuggestions(text.trim() ? db.suggestItems(text, 3) : []);
  };

  const addItem = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Learns new items and bumps usage/casing for known ones.
    db.recordItemUse(trimmed);
    db.addShoppingItem(trimmed);
    setNewItem('');
    setSuggestions([]);
    refresh();
    pushShoppingIfShared();
  };

  const isPlainCount = (amount: string) => /^\d+$/.test(amount);

  /** Steps a plain integer amount by `delta`; clears it once it would hit
   *  zero. Only meaningful for plain counts - free-form amounts like "1.2
   *  pounds" are only ever set via the edit dialog. */
  const bumpAmount = (item: ShoppingItem, delta: number) => {
    const current = item.amount && isPlainCount(item.amount) ? parseInt(item.amount, 10) : 0;
    const next = current + delta;
    db.setShoppingAmount(item.id, next > 0 ? String(next) : null);
    refresh();
    pushShoppingIfShared();
  };

  const openAmountEditor = (item: ShoppingItem) => {
    setEditingAmountItem(item);
    setAmountText(item.amount ?? '');
  };

  const commitAmount = () => {
    if (!editingAmountItem) return;
    db.setShoppingAmount(editingAmountItem.id, amountText);
    setEditingAmountItem(null);
    refresh();
    pushShoppingIfShared();
  };

  const clearAmount = () => {
    if (!editingAmountItem) return;
    db.setShoppingAmount(editingAmountItem.id, null);
    setEditingAmountItem(null);
    refresh();
    pushShoppingIfShared();
  };

  /** Creates a fresh shopping share (first share or replacing a stale key)
   *  seeded with current items, and shows the new key. */
  const createNewShoppingShare = async () => {
    setShareBusy(true);
    try {
      const snapshot = await createShare(
        'shopping',
        'Shopping',
        db.getShoppingSyncRecords() as unknown as Record<string, unknown>[]
      );
      db.setSetting(SHOPPING_SHARE_KEY_SETTING, snapshot.key);
      db.bindShoppingShare(snapshot.version);
      await refreshSyncConnections();
      setMenuOpen(false);
      setShareKeyShown(snapshot.key);
    } catch (err) {
      Alert.alert('Could not share list', err instanceof Error ? err.message : String(err));
    } finally {
      setShareBusy(false);
    }
  };

  const shareShoppingList = async () => {
    const existingKey = db.getSetting(SHOPPING_SHARE_KEY_SETTING);
    if (!existingKey) {
      await createNewShoppingShare();
      return;
    }
    // View Key: verify the share still exists before showing a key that no
    // longer works. Fail open - an unreachable server is not a dead share.
    let exists = true;
    setShareBusy(true);
    try {
      exists = await shareExists(existingKey);
    } catch {
      // Could not verify (offline, server down); behave as before.
    } finally {
      setShareBusy(false);
    }
    setMenuOpen(false);
    if (exists) {
      setShareKeyShown(existingKey);
      return;
    }
    Alert.alert(
      'Share no longer exists',
      'The server does not recognize this key anymore - the server data was reset, or the share expired after 30 days without updates. Your items are safe on this device, but they are not syncing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop Syncing',
          onPress: () => {
            db.detachShoppingShare();
            refresh();
            refreshSyncConnections();
          },
        },
        { text: 'New Key', onPress: () => void createNewShoppingShare() },
      ]
    );
  };

  const joinSharedShoppingList = async (key: string) => {
    const snapshot = await fetchShare(key);
    if (snapshot.kind !== 'shopping') {
      throw new Error('That key belongs to a todo list, not the shopping list.');
    }
    // Re-entering the key we're already bound to must not wipe local edits
    // the live sync path hasn't pushed yet; the connection reconciles them.
    if (db.getSetting(SHOPPING_SHARE_KEY_SETTING) !== key) {
      db.clearAllShoppingItems();
      db.applySyncedShoppingItems(
        snapshot.items as unknown as db.SyncShoppingItem[],
        snapshot.version
      );
      db.setSetting(SHOPPING_SHARE_KEY_SETTING, key);
    }
    refresh();
    await refreshSyncConnections();
    setJoinVisible(false);
  };

  const confirmDetachShopping = () => {
    setMenuOpen(false);
    Alert.alert(
      'Stop syncing',
      'Keep your shopping list on this device but disconnect it from the shared copy? Other users keep the list and can continue sharing it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unshare',
          onPress: () => {
            db.detachShoppingShare();
            refresh();
            refreshSyncConnections();
          },
        },
      ]
    );
  };

  const confirmDeleteShoppingList = () => {
    setMenuOpen(false);
    Alert.alert(
      'Delete shopping list',
      "Delete every shopping item, restore the default dictionary, and disconnect from any shared list? Other users' copies are not affected.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: () => {
            db.resetShoppingList();
            refresh();
            refreshSyncConnections();
          },
        },
      ]
    );
  };

  const hasChecked = items.some((i) => i.checked);

  return (
    <View style={styles.container}>
      {/* Line 1: title with settings on the far right. */}
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { fontSize: headerFontSize(fontSize) }]}>Shopping</Text>
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={8}
          accessibilityLabel="Settings"
          style={styles.settingsButton}
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </Pressable>
      </View>

      {/* Line 2: add item. */}
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="Add an item…"
          value={newItem}
          onChangeText={changeInput}
          onSubmitEditing={() => addItem(newItem)}
          returnKeyType="done"
          blurOnSubmit={false}
          maxLength={db.MAX_SHOPPING_ITEM_NAME_LENGTH}
        />
        <Pressable
          onPress={() => addItem(newItem)}
          style={styles.addButton}
          accessibilityLabel="Add item"
        >
          <Text style={styles.addPlus}>+</Text>
        </Pressable>
      </View>

      {/* Autocomplete: up to 3 dictionary matches, most-used first. */}
      {suggestions.length > 0 && (
        <View style={styles.suggestionRow}>
          {suggestions.map((s) => (
            <Pressable key={s.id} style={styles.suggestionChip} onPress={() => addItem(s.name)}>
              <Text style={styles.suggestionText} numberOfLines={1}>
                {s.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        renderItem={({ item }) => (
          <View style={[styles.itemRow, { paddingHorizontal: 16 * scale, paddingVertical: 10 * scale }]}>
            <Pressable
              style={styles.itemMain}
              onPress={() => {
                db.setShoppingChecked(item.id, !item.checked);
                refresh();
                pushShoppingIfShared();
              }}
            >
              <View
                style={[
                  styles.checkbox,
                  item.checked && styles.checkboxChecked,
                  { width: 22 * scale, height: 22 * scale, borderRadius: 4 * scale },
                ]}
              >
                {item.checked && (
                  <Text style={[styles.checkMark, { fontSize: 14 * scale }]}>✓</Text>
                )}
              </View>
              <Text
                style={[
                  styles.itemText,
                  item.checked && styles.checkedText,
                  { fontFamily, fontSize },
                ]}
                numberOfLines={1}
              >
                {item.name}
                {item.amount != null && (
                  <Text onPress={() => openAmountEditor(item)}> ({item.amount})</Text>
                )}
              </Text>
            </Pressable>
            <View style={styles.amountControls}>
              {item.amount == null && (
                <Pressable
                  onPress={() => bumpAmount(item, 1)}
                  hitSlop={8}
                  accessibilityLabel="Set amount"
                >
                  <Text style={[styles.amountBtn, { fontSize: 18 * scale }]}>+</Text>
                </Pressable>
              )}
              {item.amount != null && isPlainCount(item.amount) && (
                <>
                  <Pressable
                    onPress={() => bumpAmount(item, -1)}
                    hitSlop={8}
                    accessibilityLabel="Decrease amount"
                  >
                    <Text style={[styles.amountBtn, { fontSize: 18 * scale }]}>−</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => bumpAmount(item, 1)}
                    hitSlop={8}
                    accessibilityLabel="Increase amount"
                  >
                    <Text style={[styles.amountBtn, { fontSize: 18 * scale }]}>+</Text>
                  </Pressable>
                </>
              )}
            </View>
            <Pressable
              onPress={() => {
                db.deleteShoppingItem(item.id);
                refresh();
                pushShoppingIfShared();
              }}
              hitSlop={8}
              accessibilityLabel="Delete item"
            >
              <Text style={[styles.delete, { fontSize: 16 * scale, paddingHorizontal: 4 * scale }]}>
                ✕
              </Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Shopping list is empty. Add an item above.</Text>
        }
        contentContainerStyle={styles.listContent}
      />

      {hasChecked && (
        <Pressable
          onPress={() => {
            db.clearCheckedShoppingItems();
            refresh();
            pushShoppingIfShared();
          }}
          style={styles.clearButton}
        >
          <Text style={styles.clearText}>Clear checked items</Text>
        </Pressable>
      )}

      {/* Settings dropdown anchored under the gear. */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setDictionaryOpen(true);
              }}
            >
              <Text style={styles.menuText}>Dictionary</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={shareShoppingList} disabled={shareBusy}>
              <Text style={styles.menuText}>
                {db.getSetting(SHOPPING_SHARE_KEY_SETTING) ? 'View Share Key' : 'Share This List'}
              </Text>
            </Pressable>
            {db.getSetting(SHOPPING_SHARE_KEY_SETTING) != null && (
              <>
                <View style={styles.menuDivider} />
                <Pressable style={styles.menuItem} onPress={confirmDetachShopping}>
                  <Text style={styles.menuText}>Stop Syncing</Text>
                </Pressable>
              </>
            )}
            <View style={styles.menuDivider} />
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setJoinVisible(true);
              }}
            >
              <Text style={styles.menuText}>Join Shared List</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setServerSettingsVisible(true);
              }}
            >
              <Text style={styles.menuText}>Server Settings</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setFontSettingsVisible(true);
              }}
            >
              <Text style={styles.menuText}>Font Settings</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={confirmDeleteShoppingList}>
              <Text style={styles.menuDangerText}>Delete Shopping List</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setAboutOpen(true);
              }}
            >
              <Text style={styles.menuText}>About</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Amount edit dialog. */}
      <Modal
        visible={editingAmountItem != null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingAmountItem(null)}
      >
        <KeyboardAvoidingView style={styles.amountBackdrop} behavior="padding">
          <View style={styles.amountSheet}>
            <Text style={styles.amountHeading}>Amount</Text>
            <TextInput
              style={styles.amountInput}
              value={amountText}
              onChangeText={setAmountText}
              placeholder={`e.g. "12" or "1.2 pounds"`}
              autoFocus
              selectTextOnFocus
              onSubmitEditing={commitAmount}
              returnKeyType="done"
            />
            <View style={styles.amountActions}>
              <Pressable onPress={clearAmount} style={styles.amountButton}>
                <Text style={styles.amountClearText}>Clear</Text>
              </Pressable>
              <View style={styles.amountSpacer} />
              <Pressable
                onPress={() => setEditingAmountItem(null)}
                style={styles.amountButton}
              >
                <Text style={styles.amountCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={commitAmount} style={styles.amountButton}>
                <Text style={styles.amountSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <DictionaryModal visible={dictionaryOpen} onClose={() => setDictionaryOpen(false)} />

      <EnterKeyModal
        visible={joinVisible}
        title="Join Shared List"
        body="This replaces your current shopping list with the shared one and keeps them in sync."
        onCancel={() => setJoinVisible(false)}
        onSubmit={joinSharedShoppingList}
      />

      <ShareKeyModal
        visible={shareKeyShown != null}
        shareKey={shareKeyShown}
        onClose={() => setShareKeyShown(null)}
      />

      <ServerSettingsModal
        visible={serverSettingsVisible}
        onClose={() => setServerSettingsVisible(false)}
      />

      <FontSettingsModal
        visible={fontSettingsVisible}
        onClose={() => setFontSettingsVisible(false)}
      />

      {/* About */}
      <Modal
        visible={aboutOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAboutOpen(false)}
      >
        <View style={styles.aboutBackdrop}>
          <View style={styles.aboutSheet}>
            <Text style={styles.aboutTitle}>{APP_NAME}</Text>
            <Text style={styles.aboutVersion}>Version {APP_VERSION}</Text>
            <Text style={styles.aboutVersion}>Built {BUILD_DATE}</Text>
            <Text style={styles.aboutText}>
              A simple to-do and shopping list app. Your data stays on your device, except for
              lists you choose to share. Shared lists are stored on the server for up to 30 days
              from their last update.
            </Text>
            <Text style={styles.aboutCopyright}>{COPYRIGHT}</Text>
            <Text style={styles.aboutCopyright}>MIT License</Text>
            <Pressable onPress={() => setAboutOpen(false)} style={styles.aboutClose}>
              <Text style={styles.aboutCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fffdf5',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
  },
  heading: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#222',
  },
  settingsButton: {
    padding: 4,
  },
  settingsIcon: {
    fontSize: 22,
    color: '#555',
  },
  addRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: '#fff',
    color: '#222',
  },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1a5fb4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlus: {
    color: '#fff',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: 'bold',
  },
  suggestionRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: '#e8f0fb',
    borderColor: '#b8cfec',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexShrink: 1,
  },
  suggestionText: {
    color: '#1a5fb4',
    fontSize: 14,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  itemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#999',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    backgroundColor: '#1a5fb4',
    borderColor: '#1a5fb4',
  },
  checkMark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  itemText: {
    flex: 1,
    fontSize: 16,
    color: '#222',
  },
  amountControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 6,
  },
  amountBtn: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a5fb4',
    paddingHorizontal: 2,
  },
  amountBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 32,
  },
  amountSheet: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  amountHeading: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#222',
  },
  amountInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#222',
  },
  amountActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  amountButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  amountSpacer: {
    flex: 1,
  },
  amountClearText: {
    color: '#B00020',
    fontSize: 15,
  },
  amountCancelText: {
    color: '#666',
    fontSize: 15,
  },
  amountSaveText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 15,
  },
  checkedText: {
    textDecorationLine: 'line-through',
    color: '#999',
  },
  delete: {
    fontSize: 16,
    color: '#bbb',
    paddingHorizontal: 4,
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    color: '#999',
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 12,
  },
  clearButton: {
    padding: 14,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  clearText: {
    color: '#B00020',
    fontSize: 14,
    fontWeight: '600',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  menu: {
    position: 'absolute',
    top: 90,
    right: 14,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    minWidth: 150,
    paddingVertical: 4,
  },
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuText: {
    fontSize: 15,
    color: '#222',
  },
  menuDangerText: {
    fontSize: 15,
    color: '#c0392b',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ddd',
  },
  aboutBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 32,
  },
  aboutSheet: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  aboutTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#222',
  },
  aboutVersion: {
    fontSize: 14,
    color: '#777',
    marginTop: 4,
  },
  aboutText: {
    fontSize: 14,
    color: '#444',
    textAlign: 'center',
    marginTop: 12,
  },
  aboutCopyright: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
  aboutClose: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  aboutCloseText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
