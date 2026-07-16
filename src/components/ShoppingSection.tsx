import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { APP_NAME, APP_VERSION, BUILD_DATE, COPYRIGHT } from '../appInfo';
import * as db from '../db';
import { DictionaryEntry, ShoppingItem } from '../types';
import DictionaryModal from './DictionaryModal';

export default function ShoppingSection() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [suggestions, setSuggestions] = useState<DictionaryEntry[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const refresh = useCallback(() => setItems(db.getShoppingItems()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
  };

  const hasChecked = items.some((i) => i.checked);

  return (
    <View style={styles.container}>
      {/* Line 1: title with settings on the far right. */}
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Shopping</Text>
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
          <View style={styles.itemRow}>
            <Pressable
              style={styles.itemMain}
              onPress={() => {
                db.setShoppingChecked(item.id, !item.checked);
                refresh();
              }}
            >
              <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
                {item.checked && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={[styles.itemText, item.checked && styles.checkedText]}>
                {item.name}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                db.deleteShoppingItem(item.id);
                refresh();
              }}
              hitSlop={8}
              accessibilityLabel="Delete item"
            >
              <Text style={styles.delete}>✕</Text>
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

      <DictionaryModal visible={dictionaryOpen} onClose={() => setDictionaryOpen(false)} />

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
              A simple to-do and shopping list app. All data stays on your device.
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
