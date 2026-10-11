import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { APP_NAME, APP_VERSION, BUILD_DATE, COPYRIGHT } from '../appInfo';
import * as db from '../db';
import { parseListText, shoppingListToText } from '../exportText';
import { subscribeRemoteUpdate } from '../remoteUpdates';
import { joinShareByKey } from '../joinShare';
import { createShare, shareExists } from '../syncClient';
import { pushShoppingListIfShared, refreshSyncConnections } from '../syncManager';
import { headerFontSize, useTextSettings } from '../textSettings';
import { DictionaryEntry, ShoppingItem, ShoppingList } from '../types';
import DictionaryModal from './DictionaryModal';
import EnterKeyModal from './EnterKeyModal';
import FontSettingsModal from './FontSettingsModal';
import ImportListModal from './ImportListModal';
import ItemMenuModal from './ItemMenuModal';
import JoinScanModal from './JoinScanModal';
import ListTab from './ListTab';
import ServerSettingsModal from './ServerSettingsModal';
import ShareKeyModal from './ShareKeyModal';

/** The ☰ handle on a shopping item row. It claims the touch the moment it
 *  is pressed (no long-press arming), so dragging an item onto another
 *  list's tab never fumbles. Shopping items have no manual reorder, so
 *  moving between lists is the handle's only job. Callbacks are routed
 *  through refs because the PanResponder is created once per row. */
function ItemDragHandle({
  item,
  scale,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: ShoppingItem;
  scale: number;
  onDragStart: (item: ShoppingItem) => void;
  onDragMove: (pageX: number, pageY: number) => void;
  onDragEnd: (item: ShoppingItem) => void;
}) {
  const itemRef = useRef(item);
  itemRef.current = item;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  // Touch pageY and measureInWindow Y can disagree by the status-bar height
  // on some Android setups, which would put the tab rects (measured via
  // measureInWindow) out of reach of the finger coordinates. Calibrated at
  // drag start from the handle's own position (zero on well-behaved devices).
  const viewRef = useRef<View>(null);
  const pageYOffsetRef = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Never let the list scroll (or any ancestor) steal an active drag.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const { pageY, locationY } = evt.nativeEvent;
        pageYOffsetRef.current = 0;
        viewRef.current?.measureInWindow((_x, y) => {
          pageYOffsetRef.current = pageY - (y + locationY);
        });
        onDragStartRef.current(itemRef.current);
      },
      onPanResponderMove: (evt) =>
        onDragMoveRef.current(
          evt.nativeEvent.pageX,
          evt.nativeEvent.pageY - pageYOffsetRef.current
        ),
      onPanResponderRelease: () => onDragEndRef.current(itemRef.current),
      onPanResponderTerminate: () => onDragEndRef.current(itemRef.current),
    })
  ).current;
  return (
    <View
      ref={viewRef}
      {...pan.panHandlers}
      style={{ paddingLeft: 6 * scale, paddingVertical: 2 * scale }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityLabel="Drag to move item to another list"
    >
      <Text style={[styles.dragHandleIcon, { fontSize: 16 * scale }]}>☰</Text>
    </View>
  );
}

export default function ShoppingSection() {
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [suggestions, setSuggestions] = useState<DictionaryEntry[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [joinVisible, setJoinVisible] = useState(false);
  const [scanVisible, setScanVisible] = useState(false);
  const [renamingList, setRenamingList] = useState<ShoppingList | null>(null);
  const [renameText, setRenameText] = useState('');
  const [serverSettingsVisible, setServerSettingsVisible] = useState(false);
  const [fontSettingsVisible, setFontSettingsVisible] = useState(false);
  const [shareKeyShown, setShareKeyShown] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [editingAmountItem, setEditingAmountItem] = useState<ShoppingItem | null>(null);
  const [nameText, setNameText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [draggingListId, setDraggingListId] = useState<number | null>(null);
  const [dragOverListId, setDragOverListId] = useState<number | null>(null);
  const { fontFamily, fontSize, scale } = useTextSettings();

  const refreshLists = useCallback((preferId?: number) => {
    const all = db.getShoppingLists();
    setLists(all);
    setActiveListId((current) => {
      const want = preferId ?? current;
      return all.some((l) => l.id === want) ? want! : all[0]?.id ?? null;
    });
  }, []);

  const refreshItems = useCallback((listId: number | null) => {
    setItems(listId == null ? [] : db.getShoppingItems(listId));
  }, []);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    refreshItems(activeListId);
  }, [activeListId, refreshItems]);

  // Live-refresh when another peer updates a shared shopping list.
  useEffect(
    () =>
      subscribeRemoteUpdate((target) => {
        if (target.type !== 'shopping') return;
        refreshLists();
        refreshItems(activeListId);
      }),
    [refreshLists, refreshItems, activeListId]
  );

  const activeList = lists.find((l) => l.id === activeListId) ?? null;

  // ----- tab strip: measurement, scroll-into-view, drag-to-reorder -----

  type Rect = { x: number; y: number; width: number; height: number };
  const tabRefs = useRef(new Map<number, View>()).current;
  const tabRectsRef = useRef(new Map<number, Rect>()).current;
  // Content-relative (not page-relative) tab positions, used to scroll the
  // active tab into view - distinct from tabRectsRef, which tracks page
  // coordinates for drag hit-testing.
  const tabLayoutsRef = useRef(new Map<number, { x: number; width: number }>()).current;
  const tabStripViewportWidthRef = useRef(0);

  // Auto-scroll the horizontal tab strip while dragging a tab near a screen
  // edge, so tabs that are currently scrolled off-screen can still be reached.
  const tabScrollViewRef = useRef<ScrollView>(null);
  const tabScrollXRef = useRef(0);
  const dragPageRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const AUTOSCROLL_EDGE = 48;
  const AUTOSCROLL_STEP = 16;

  const measureTabs = useCallback(() => {
    tabRefs.forEach((view, listId) => {
      view.measureInWindow((x, y, width, height) => {
        tabRectsRef.set(listId, { x, y, width, height });
      });
    });
  }, [tabRefs, tabRectsRef]);

  const SCROLL_INTO_VIEW_PADDING = 16;

  /** Scrolls the tab strip just enough to bring `listId`'s tab fully into
   *  view, if it isn't already - e.g. after selecting, creating, or joining
   *  a list whose tab is currently scrolled off-screen. */
  const scrollTabIntoView = useCallback(
    (listId: number) => {
      const layout = tabLayoutsRef.get(listId);
      const viewportWidth = tabStripViewportWidthRef.current;
      if (!layout || !viewportWidth) return;
      const scrollX = tabScrollXRef.current;
      const { x, width } = layout;
      if (x < scrollX + SCROLL_INTO_VIEW_PADDING) {
        const newX = Math.max(0, x - SCROLL_INTO_VIEW_PADDING);
        tabScrollXRef.current = newX;
        tabScrollViewRef.current?.scrollTo({ x: newX, animated: true });
      } else if (x + width > scrollX + viewportWidth - SCROLL_INTO_VIEW_PADDING) {
        const newX = Math.max(0, x + width - viewportWidth + SCROLL_INTO_VIEW_PADDING);
        tabScrollXRef.current = newX;
        tabScrollViewRef.current?.scrollTo({ x: newX, animated: true });
      }
    },
    [tabLayoutsRef]
  );

  useEffect(() => {
    if (activeListId != null) scrollTabIntoView(activeListId);
  }, [activeListId, scrollTabIntoView]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current != null) {
      clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
  }, []);

  const startAutoScroll = useCallback(() => {
    stopAutoScroll();
    autoScrollTimerRef.current = setInterval(() => {
      const point = dragPageRef.current;
      if (!point) return;
      const screenWidth = Dimensions.get('window').width;
      let delta = 0;
      if (point.x < AUTOSCROLL_EDGE) delta = -AUTOSCROLL_STEP;
      else if (point.x > screenWidth - AUTOSCROLL_EDGE) delta = AUTOSCROLL_STEP;
      if (delta !== 0) {
        const newX = Math.max(0, tabScrollXRef.current + delta);
        tabScrollViewRef.current?.scrollTo({ x: newX, animated: false });
        // Tab positions shifted, so re-measure them for accurate drop hit-testing.
        measureTabs();
      }
    }, 32);
  }, [stopAutoScroll, measureTabs]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const handleListDragStart = useCallback(
    (list: ShoppingList) => {
      measureTabs();
      setDraggingListId(list.id);
      setDragOverListId(null);
      startAutoScroll();
    },
    [measureTabs, startAutoScroll]
  );

  const handleListDragMove = useCallback((_list: ShoppingList, pageX: number, pageY: number) => {
    dragPageRef.current = { x: pageX, y: pageY };
    let overId: number | null = null;
    for (const [listId, rect] of tabRectsRef) {
      if (pageX >= rect.x && pageX <= rect.x + rect.width) {
        overId = listId;
        break;
      }
    }
    setDragOverListId(overId);
  }, [tabRectsRef]);

  // ----- item move: long-press an item, pick the target list from a menu -----

  // Item whose "Move to list" picker is open.
  const [moveItem, setMoveItem] = useState<ShoppingItem | null>(null);

  const moveItemTo = (item: ShoppingItem, targetListId: number) => {
    setMoveItem(null);
    if (targetListId === item.listId) return;
    db.moveShoppingItemToList(item.id, targetListId);
    refreshItems(activeListIdRef.current);
    pushShoppingListIfShared(item.listId);
    pushShoppingListIfShared(targetListId);
  };

  // Like a move, but the source list keeps its copy.
  const copyItemTo = (item: ShoppingItem, targetListId: number) => {
    setMoveItem(null);
    if (targetListId === item.listId) return;
    db.copyShoppingItemToList(item.id, targetListId);
    pushShoppingListIfShared(targetListId);
  };

  // ----- handle-driven item drag: drop on another list's tab to move -----
  // Plain functions, not useCallbacks: ItemDragHandle routes its PanResponder
  // callbacks through refs, so these never go stale.

  const [draggingItemId, setDraggingItemId] = useState<number | null>(null);

  const handleItemDragStart = (item: ShoppingItem) => {
    measureTabs();
    setDraggingItemId(item.id);
    setDragOverListId(null);
    startAutoScroll();
  };

  const handleItemDragMove = (pageX: number, pageY: number) => {
    dragPageRef.current = { x: pageX, y: pageY };
    // Unlike tab reordering, which only cares about X, an item drag starts
    // far below the tab strip - so the finger must really be on a tab.
    let overId: number | null = null;
    for (const [listId, rect] of tabRectsRef) {
      if (
        pageX >= rect.x &&
        pageX <= rect.x + rect.width &&
        pageY >= rect.y &&
        pageY <= rect.y + rect.height
      ) {
        overId = listId;
        break;
      }
    }
    setDragOverListId(overId);
  };

  const handleItemDragEnd = (item: ShoppingItem) => {
    stopAutoScroll();
    dragPageRef.current = null;
    const overId = dragOverListIdRef.current;
    setDraggingItemId(null);
    setDragOverListId(null);
    if (overId != null) moveItemTo(item, overId);
  };

  const handleListDragEnd = useCallback(
    (list: ShoppingList) => {
      stopAutoScroll();
      dragPageRef.current = null;
      setDraggingListId(null);
      const overId = dragOverListIdRef.current;
      setDragOverListId(null);

      if (overId != null && overId !== list.id) {
        const current = listsRef.current;
        const withoutDragged = current.filter((l) => l.id !== list.id);
        const targetIndex = withoutDragged.findIndex((l) => l.id === overId);
        // Dragging right drops AFTER the hovered tab, dragging left drops
        // BEFORE it - so the dragged tab takes the hovered tab's place in
        // both directions, and dropping on the last tab from the left makes
        // the dragged list the last one.
        const fromIndex = current.findIndex((l) => l.id === list.id);
        const toIndex = current.findIndex((l) => l.id === overId);
        let insertAt = targetIndex === -1 ? withoutDragged.length : targetIndex;
        if (targetIndex !== -1 && fromIndex !== -1 && fromIndex < toIndex) {
          insertAt = targetIndex + 1;
        }
        withoutDragged.splice(insertAt, 0, list);
        db.reorderShoppingLists(withoutDragged.map((l) => l.id));
        refreshLists(list.id);
      }
    },
    [refreshLists, stopAutoScroll]
  );

  // ----- swipe-to-switch-list -----

  // Keep refs in sync so the PanResponder (created once) always sees fresh data.
  const listsRef = useRef(lists);
  useEffect(() => {
    listsRef.current = lists;
  }, [lists]);
  const activeListIdRef = useRef(activeListId);
  useEffect(() => {
    activeListIdRef.current = activeListId;
  }, [activeListId]);
  // Drag-over target must also be a ref: the useCallback closure for
  // handleListDragEnd would otherwise capture stale state because React may
  // not have flushed the latest set* from handleListDragMove.
  const dragOverListIdRef = useRef(dragOverListId);
  useEffect(() => {
    dragOverListIdRef.current = dragOverListId;
  }, [dragOverListId]);

  const switchListByOffset = useCallback((offset: number) => {
    const currentLists = listsRef.current;
    if (currentLists.length < 2) return;
    const currentIndex = currentLists.findIndex((l) => l.id === activeListIdRef.current);
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    // Wrap around in both directions, e.g. sliding past the last list rolls back to the first.
    const nextIndex = (baseIndex + offset + currentLists.length) % currentLists.length;
    setActiveListId(currentLists[nextIndex].id);
  }, []);

  const SWIPE_THRESHOLD = 50;
  const panResponder = useRef(
    PanResponder.create({
      // Only claim single-finger drags, so a two-finger swipe (which switches
      // between the To Do / Shopping sections) is left for the parent to handle.
      onMoveShouldSetPanResponder: (evt, gestureState) =>
        evt.nativeEvent.touches.length === 1 &&
        Math.abs(gestureState.dx) > 20 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5,
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dx <= -SWIPE_THRESHOLD) {
          switchListByOffset(1); // swipe left -> next list
        } else if (gestureState.dx >= SWIPE_THRESHOLD) {
          switchListByOffset(-1); // swipe right -> previous list
        }
      },
    }),
  ).current;

  // ----- tab actions -----

  const addList = () => {
    const created = db.createShoppingList();
    refreshLists(created.id);
  };

  const openAddMenu = () => setAddMenuVisible(true);

  const startNewList = () => {
    setAddMenuVisible(false);
    addList();
  };

  const startJoinList = () => {
    setAddMenuVisible(false);
    setJoinVisible(true);
  };

  const startScanList = () => {
    setAddMenuVisible(false);
    setScanVisible(true);
  };

  const joinFromScan = async (key: string) => {
    setScanVisible(false);
    try {
      await joinSharedList(key);
    } catch (err) {
      Alert.alert('Could not join list', err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDeleteAllLists = () => {
    setAddMenuVisible(false);
    Alert.alert(
      'Delete all lists',
      'Delete every shopping list and all of their items? This cannot be undone. Copies of shared lists on other devices are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: () => {
            db.deleteAllShoppingLists();
            refreshLists();
            refreshSyncConnections();
          },
        },
      ]
    );
  };

  const joinSharedList = async (key: string) => {
    // A todo key entered here still joins - it just lands in the To Do
    // section instead of being rejected.
    const result = await joinShareByKey(key);
    if (result.kind === 'shopping') {
      refreshLists(result.listId);
    } else {
      Alert.alert(
        'Todo list joined',
        'That key belongs to a shared todo list, so it was added to your To Do section.'
      );
    }
    setJoinVisible(false);
  };

  const openRename = (list: ShoppingList) => {
    setRenamingList(list);
    setRenameText(list.name);
  };

  const commitRename = () => {
    if (renamingList && renameText.trim()) {
      db.renameShoppingList(renamingList.id, renameText);
      pushShoppingListIfShared(renamingList.id);
      refreshLists();
    }
    setRenamingList(null);
  };

  /** Creates a fresh share for a list (first share or replacing a stale
   *  key), seeds it with current content, and shows the new key. */
  const createNewShare = async (list: ShoppingList) => {
    setShareBusy(true);
    try {
      const snapshot = await createShare(
        'shopping',
        list.name,
        db.getShoppingSyncRecords(list.id) as unknown as Record<string, unknown>[]
      );
      db.setShoppingListShareKey(list.id, snapshot.key, snapshot.version);
      refreshLists();
      await refreshSyncConnections();
      setRenamingList(null);
      setShareKeyShown(snapshot.key);
    } catch (err) {
      Alert.alert('Could not share list', err instanceof Error ? err.message : String(err));
    } finally {
      setShareBusy(false);
    }
  };

  const shareList = async (list: ShoppingList) => {
    if (!list.shareKey) {
      await createNewShare(list);
      return;
    }
    // View Key: verify the share still exists before showing a key that no
    // longer works. Fail open - an unreachable server is not a dead share.
    const key = list.shareKey;
    let exists = true;
    setShareBusy(true);
    try {
      exists = await shareExists(key);
    } catch {
      // Could not verify (offline, server down); behave as before.
    } finally {
      setShareBusy(false);
    }
    setRenamingList(null);
    if (exists) {
      setShareKeyShown(key);
      return;
    }
    Alert.alert(
      'Share no longer exists',
      'The server does not recognize this key anymore - the server data was reset, or the share expired after 30 days without updates. Your list is safe on this device, but it is not syncing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unshare',
          onPress: () => {
            db.detachShoppingList(list.id);
            refreshLists();
            refreshSyncConnections();
          },
        },
        { text: 'New Key', onPress: () => void createNewShare(list) },
      ]
    );
  };

  const confirmDetachList = (list: ShoppingList) => {
    setRenamingList(null);
    Alert.alert(
      'Stop syncing',
      `Keep "${list.name}" on this device but disconnect it from the shared copy? Other users keep the list and can continue sharing it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unshare',
          onPress: () => {
            db.detachShoppingList(list.id);
            refreshLists();
            refreshSyncConnections();
          },
        },
      ]
    );
  };

  /** Duplicates the list into a new local, unshared list - a private copy
   *  other members of a share cannot change - and switches to it. */
  const copyList = (list: ShoppingList) => {
    setRenamingList(null);
    const copy = db.copyShoppingList(list.id);
    refreshLists(copy.id);
  };

  const importFromText = (text: string) => {
    const parsed = parseListText(text);
    if (parsed.items.length === 0) {
      Alert.alert('Nothing to import', 'No list items found in that text.');
      return;
    }
    const list = db.importShoppingList(
      parsed.name ?? 'Imported',
      parsed.items.map((it) => ({ name: it.text, checked: it.checked, amount: it.amount }))
    );
    setImportVisible(false);
    refreshLists(list.id);
  };

  // Hands the list as readable text to the system share sheet (email,
  // messages, ...). Reading it back in is `Import` on the "+" menu.
  const exportList = (list: ShoppingList) => {
    setRenamingList(null);
    Share.share({ message: shoppingListToText(list.name, db.getShoppingItems(list.id)) }).catch(
      () => {
        // Dismissed or no share targets - nothing to clean up.
      }
    );
  };

  const confirmDeleteList = (list: ShoppingList) => {
    setRenamingList(null);
    Alert.alert('Delete list', `Delete "${list.name}" and all of its items?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          db.deleteShoppingList(list.id);
          refreshLists();
          refreshSyncConnections();
        },
      },
    ]);
  };

  // ----- item actions -----

  const changeInput = (text: string) => {
    setNewItem(text);
    if (!text.trim()) {
      setSuggestions([]);
      return;
    }
    // Never suggest something already on the list (checked or not) - the
    // dictionary is for speeding up what's missing. Over-fetch so filtering
    // still leaves up to 3 chips.
    const onList = new Set(items.map((i) => i.name.trim().toLowerCase()));
    setSuggestions(
      db
        .suggestItems(text, 10)
        .filter((s) => !onList.has(s.name.trim().toLowerCase()))
        .slice(0, 3)
    );
  };

  const addItem = (raw: string) => {
    if (activeListId == null) return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    // Shorthand "item, amount" - split off the amount before it ever
    // touches the dictionary, which only ever learns bare item names.
    const commaIndex = trimmed.indexOf(',');
    const name = (commaIndex === -1 ? trimmed : trimmed.slice(0, commaIndex)).trim();
    const amount = commaIndex === -1 ? null : trimmed.slice(commaIndex + 1).trim() || null;
    if (!name) return;
    // No duplicates: adding a name already on the list re-activates the
    // existing row instead. Pending items with an INTEGER amount are
    // additive - a bare re-add means one more, an integer amount sums -
    // while free-form amounts ("1.2 pounds") only ever replace. Re-adding
    // a crossed-off item just un-crosses it, amount untouched.
    const isInt = (v: string | null): v is string => v != null && /^\d+$/.test(v.trim());
    const existing = items.find((i) => i.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      if (existing.checked) {
        db.setShoppingChecked(existing.id, false);
      } else {
        let next: string | null | undefined;
        if (isInt(existing.amount) && amount == null) {
          next = String(parseInt(existing.amount.trim(), 10) + 1);
        } else if (isInt(existing.amount) && isInt(amount)) {
          next = String(parseInt(existing.amount.trim(), 10) + parseInt(amount.trim(), 10));
        } else if (amount != null && amount !== existing.amount) {
          next = amount;
        }
        if (next === undefined) {
          // Nothing to change - it's already on the list.
          setNewItem('');
          setSuggestions([]);
          return;
        }
        db.updateShoppingItem(existing.id, existing.name, next);
      }
      refreshItems(activeListId);
      pushShoppingListIfShared(activeListId);
      setNewItem('');
      setSuggestions([]);
      return;
    }
    // Learns new items and bumps usage/casing for known ones.
    db.recordItemUse(name);
    db.addShoppingItem(activeListId, name, amount);
    setNewItem('');
    setSuggestions([]);
    refreshItems(activeListId);
    pushShoppingListIfShared(activeListId);
  };

  const openAmountEditor = (item: ShoppingItem) => {
    setEditingAmountItem(item);
    setNameText(item.name);
    setAmountText(item.amount ?? '');
  };

  const commitAmount = () => {
    if (!editingAmountItem) return;
    // An emptied name keeps the old one - deleting is a separate action.
    const name = nameText.trim() || editingAmountItem.name;
    db.updateShoppingItem(editingAmountItem.id, name, amountText.trim() || null);
    setEditingAmountItem(null);
    refreshItems(activeListId);
    pushShoppingListIfShared(editingAmountItem.listId);
  };

  // Clears the amount field only; nothing is saved until Save.
  const clearAmount = () => setAmountText('');

  const hasChecked = items.some((i) => i.checked);

  return (
    <View style={styles.container}>
      {/* Tab strip: one tab per list plus a "+" tab that creates or joins a list. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        ref={tabScrollViewRef}
        onLayout={(e) => {
          tabStripViewportWidthRef.current = e.nativeEvent.layout.width;
        }}
        onScroll={(e) => {
          tabScrollXRef.current = e.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={32}
        style={styles.tabStrip}
        contentContainerStyle={styles.tabStripContent}
      >
        {lists.map((list) => (
          <ListTab
            key={list.id}
            ref={(r) => {
              if (r) tabRefs.set(list.id, r);
              else tabRefs.delete(list.id);
            }}
            list={list}
            dragging={draggingListId === list.id}
            dragHitSlop={0}
            style={[
              styles.tab,
              list.id === activeListId && styles.tabActive,
              draggingItemId != null && list.id !== activeListId && styles.tabDropTarget,
              dragOverListId === list.id && styles.tabDragOver,
            ]}
            textStyle={[
              styles.tabText,
              list.id === activeListId && styles.tabTextActive,
              { fontFamily, fontSize: 14 * scale },
            ]}
            onSelect={() => setActiveListId(list.id)}
            onRename={() => {
              // Long-pressing any tab targets that list: make it active and
              // open the same rename/share/copy/delete dialog.
              setActiveListId(list.id);
              openRename(list);
            }}
            onDragStart={handleListDragStart}
            onDragMove={handleListDragMove}
            onDragEnd={handleListDragEnd}
            onLayout={(e) => {
              tabLayoutsRef.set(list.id, {
                x: e.nativeEvent.layout.x,
                width: e.nativeEvent.layout.width,
              });
              // The just-created/just-selected tab may not have had a
              // recorded layout yet when the activeListId effect ran.
              if (list.id === activeListId) scrollTabIntoView(list.id);
            }}
          />
        ))}
        <Pressable onPress={openAddMenu} style={styles.tab} accessibilityLabel="Add list">
          <Text style={[styles.plusTab, { fontSize: 16 * scale }]}>+</Text>
        </Pressable>
      </ScrollView>

      {/* Header + items: a one-finger horizontal slide here switches lists. */}
      <View style={styles.swipeArea} {...panResponder.panHandlers}>
        {/* Line 1: active list name with settings on the far right. */}
        <View style={styles.headerRow}>
          <Text
            style={[styles.heading, { fontFamily, fontSize: headerFontSize(fontSize) }]}
            numberOfLines={1}
          >
            {activeList?.name ?? ''}
          </Text>
          <Pressable
            onPress={() => setMenuOpen(true)}
            hitSlop={8}
            accessibilityLabel="Settings"
            style={styles.settingsButton}
          >
            <Text style={[styles.settingsIcon, { fontSize: 22 * scale }]}>⚙</Text>
          </Pressable>
        </View>

        {/* Line 2: add item. */}
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, { fontFamily, fontSize }]}
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
            style={[
              styles.addButton,
              { width: 38 * scale, height: 38 * scale, borderRadius: 19 * scale },
            ]}
            accessibilityLabel="Add item"
          >
            <Text style={[styles.addPlus, { fontSize: 24 * scale, lineHeight: 28 * scale }]}>+</Text>
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
          // A handle drag must freeze list scrolling: on Android the native
          // ScrollView intercepts moves below the JS responder layer, so
          // onPanResponderTerminationRequest alone can't hold the gesture.
          scrollEnabled={draggingItemId == null}
          renderItem={({ item }) => (
            <View
              style={[
                styles.itemRow,
                { paddingHorizontal: 16 * scale, paddingVertical: 10 * scale },
                draggingItemId === item.id && styles.itemRowDragging,
              ]}
            >
              <Pressable
                style={styles.itemMain}
                onPress={() => {
                  db.setShoppingChecked(item.id, !item.checked);
                  refreshItems(activeListId);
                  pushShoppingListIfShared(item.listId);
                }}
                // Long-press opens the action menu (cross off / delete /
                // move to another list) - a menu is reliable where the old
                // long-press-drag was easy to fumble.
                onLongPress={() => setMoveItem(item)}
                delayLongPress={300}
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
              <Pressable
                onPress={() => openAmountEditor(item)}
                hitSlop={10}
                style={styles.amountControls}
                accessibilityLabel={item.amount == null ? 'Set amount' : 'Edit amount'}
              >
                <Text style={[styles.amountBtn, { fontSize: 18 * scale }]}>+</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  db.deleteShoppingItem(item.id);
                  refreshItems(activeListId);
                  pushShoppingListIfShared(item.listId);
                }}
                hitSlop={10}
                style={styles.deleteTouch}
                accessibilityLabel="Delete item"
              >
                <Text style={[styles.delete, { fontSize: 16 * scale }]}>✕</Text>
              </Pressable>
              <ItemDragHandle
                item={item}
                scale={scale}
                onDragStart={handleItemDragStart}
                onDragMove={handleItemDragMove}
                onDragEnd={handleItemDragEnd}
              />
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
              if (activeListId == null) return;
              db.clearCheckedShoppingItems(activeListId);
              refreshItems(activeListId);
              pushShoppingListIfShared(activeListId);
            }}
            style={styles.clearButton}
          >
            <Text style={styles.clearText}>Clear checked items</Text>
          </Pressable>
        )}
      </View>

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

      {/* Rename / share / delete list dialog (opened by long-pressing a tab). */}
      <Modal
        visible={renamingList != null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenamingList(null)}
      >
        <View style={styles.backdrop}>
          <KeyboardAvoidingView behavior="padding">
            <View style={styles.renameSheet}>
              <Text style={styles.renameHeading}>Rename list</Text>
              <TextInput
                style={styles.renameInput}
                value={renameText}
                onChangeText={setRenameText}
                autoFocus
                selectTextOnFocus
              />
              {renamingList?.shareKey && <Text style={styles.sharedNote}>🔗 This list is shared</Text>}
              {shareBusy && <ActivityIndicator style={styles.renameSpinner} />}
              <View style={styles.renameActions}>
                <Pressable
                  onPress={() => renamingList && confirmDeleteList(renamingList)}
                  style={styles.renameButton}
                  disabled={shareBusy}
                >
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
                <Pressable
                  onPress={() => renamingList && shareList(renamingList)}
                  style={styles.renameButton}
                  disabled={shareBusy}
                >
                  <Text style={styles.shareText}>
                    {renamingList?.shareKey ? 'View Key' : 'Share'}
                  </Text>
                </Pressable>
                {renamingList?.shareKey != null && (
                  <Pressable
                    onPress={() => renamingList && confirmDetachList(renamingList)}
                    style={styles.renameButton}
                    disabled={shareBusy}
                  >
                    <Text style={styles.shareText}>Unshare</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => renamingList && copyList(renamingList)}
                  style={styles.renameButton}
                  disabled={shareBusy}
                >
                  <Text style={styles.shareText}>Copy</Text>
                </Pressable>
                <Pressable
                  onPress={() => renamingList && exportList(renamingList)}
                  style={styles.renameButton}
                  disabled={shareBusy}
                >
                  <Text style={styles.shareText}>Export</Text>
                </Pressable>
                <View style={styles.renameSpacer} />
                <Pressable onPress={() => setRenamingList(null)} style={styles.renameButton}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={commitRename} style={styles.renameButton}>
                  <Text style={styles.saveText}>Save</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* "+" chooser: start a brand new list, or join one someone shared with you. */}
      <Modal
        visible={addMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddMenuVisible(false)}
      >
        <Pressable style={styles.addMenuBackdrop} onPress={() => setAddMenuVisible(false)}>
          <View style={styles.addMenu}>
            <Pressable style={styles.menuItem} onPress={startNewList}>
              <Text style={styles.menuText}>New List</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={startJoinList}>
              <Text style={styles.menuText}>Join Shared List</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={startScanList}>
              <Text style={styles.menuText}>Scan QR Code</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setAddMenuVisible(false);
                setImportVisible(true);
              }}
            >
              <Text style={styles.menuText}>Import List</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={confirmDeleteAllLists}>
              <Text style={styles.menuDangerText}>Delete All Lists</Text>
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
            <Text style={[styles.amountHeading, { fontFamily, fontSize: headerFontSize(fontSize) }]}>
              Edit item
            </Text>
            <Text style={styles.amountLabel}>Name</Text>
            <TextInput
              style={[styles.amountInput, { fontFamily, fontSize }]}
              value={nameText}
              onChangeText={setNameText}
              autoFocus
              selectTextOnFocus
              returnKeyType="next"
            />
            <Text style={styles.amountLabel}>Amount</Text>
            <TextInput
              style={[styles.amountInput, { fontFamily, fontSize }]}
              value={amountText}
              onChangeText={setAmountText}
              placeholder={`e.g. "12" or "1.2 pounds"`}
              onSubmitEditing={commitAmount}
              returnKeyType="done"
            />
            <View style={styles.amountActions}>
              <Pressable onPress={clearAmount} style={styles.amountButton}>
                <Text style={[styles.amountClearText, { fontFamily, fontSize }]}>Clear</Text>
              </Pressable>
              <View style={styles.amountSpacer} />
              <Pressable
                onPress={() => setEditingAmountItem(null)}
                style={styles.amountButton}
              >
                <Text style={[styles.amountCancelText, { fontFamily, fontSize }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={commitAmount} style={styles.amountButton}>
                <Text style={[styles.amountSaveText, { fontFamily, fontSize }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Item action menu, opened by long-pressing an item. */}
      <ItemMenuModal
        visible={moveItem != null}
        title={moveItem?.name ?? ''}
        actions={[
          {
            label: moveItem?.checked ? 'Un-cross off' : 'Cross off',
            onPress: () => {
              if (!moveItem) return;
              setMoveItem(null);
              db.setShoppingChecked(moveItem.id, !moveItem.checked);
              refreshItems(activeListId);
              pushShoppingListIfShared(moveItem.listId);
            },
          },
          {
            label: 'Edit',
            onPress: () => {
              if (!moveItem) return;
              const item = moveItem;
              setMoveItem(null);
              openAmountEditor(item);
            },
          },
          {
            label: 'Delete',
            destructive: true,
            onPress: () => {
              if (!moveItem) return;
              setMoveItem(null);
              db.deleteShoppingItem(moveItem.id);
              refreshItems(activeListId);
              pushShoppingListIfShared(moveItem.listId);
            },
          },
        ]}
        lists={lists.filter((l) => l.id !== moveItem?.listId)}
        onPick={(targetId) => moveItem && moveItemTo(moveItem, targetId)}
        onPickCopy={(targetId) => moveItem && copyItemTo(moveItem, targetId)}
        onClose={() => setMoveItem(null)}
      />

      <ImportListModal
        visible={importVisible}
        noun="item"
        onImport={importFromText}
        onClose={() => setImportVisible(false)}
      />

      <DictionaryModal visible={dictionaryOpen} onClose={() => setDictionaryOpen(false)} />

      <EnterKeyModal
        visible={joinVisible}
        title="Join Shared List"
        body="Enter the share key someone gave you to add their list here."
        onCancel={() => setJoinVisible(false)}
        onSubmit={joinSharedList}
      />

      <JoinScanModal
        visible={scanVisible}
        onCancel={() => setScanVisible(false)}
        onScanned={(key) => void joinFromScan(key)}
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
  tabStrip: {
    flexGrow: 0,
    backgroundColor: '#f2f0e8',
  },
  tabStripContent: {
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: '#e3e0d3',
    marginRight: 4,
    maxWidth: 160,
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: '#fffdf5',
  },
  tabDropTarget: {
    paddingVertical: 18,
    borderWidth: 2,
    borderColor: 'rgba(26,95,180,0.35)',
    borderStyle: 'dashed',
  },
  tabDragOver: {
    backgroundColor: '#d6e6fb',
    borderColor: '#1a5fb4',
    borderWidth: 2,
    borderStyle: 'solid',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
  },
  tabTextActive: {
    color: '#222',
    fontWeight: 'bold',
  },
  plusTab: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#555',
  },
  swipeArea: {
    flex: 1,
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
    flex: 1,
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
  itemRowDragging: {
    backgroundColor: '#e8f0fb',
  },
  dragHandleIcon: {
    // Dark enough to read as enabled, matching the delete ✕.
    color: 'rgba(0,0,0,0.65)',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 24,
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  amountBtn: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a5fb4',
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
  amountLabel: {
    fontSize: 13,
    color: '#666',
    marginTop: 8,
    marginBottom: 4,
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
  deleteTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  delete: {
    fontSize: 16,
    // Dark enough to read as enabled - #bbb looked disabled.
    color: '#555',
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  renameSheet: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  renameHeading: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#222',
  },
  renameInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#222',
  },
  renameActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 12,
  },
  renameSpacer: {
    flex: 1,
  },
  renameButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  deleteText: {
    color: '#B00020',
    fontSize: 15,
  },
  cancelText: {
    color: '#666',
    fontSize: 15,
  },
  saveText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 15,
  },
  shareText: {
    color: '#1a5fb4',
    fontSize: 15,
  },
  sharedNote: {
    marginTop: 8,
    fontSize: 13,
    color: '#666',
  },
  renameSpinner: {
    marginTop: 8,
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
  addMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addMenu: {
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    minWidth: 200,
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
