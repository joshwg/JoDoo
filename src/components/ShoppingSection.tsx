import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as db from '../db';
import { ShoppingItem } from '../types';

export default function ShoppingSection() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newItem, setNewItem] = useState('');

  const refresh = useCallback(() => setItems(db.getShoppingItems()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = () => {
    const name = newItem.trim();
    if (!name) return;
    db.addShoppingItem(name);
    setNewItem('');
    refresh();
  };

  const hasChecked = items.some((i) => i.checked);

  return (
    <View style={styles.container}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="Add an item…"
          value={newItem}
          onChangeText={setNewItem}
          onSubmitEditing={add}
          returnKeyType="done"
          blurOnSubmit={false}
        />
        <Pressable onPress={add} style={styles.addButton} accessibilityLabel="Add item">
          <Text style={styles.addPlus}>+</Text>
        </Pressable>
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fffdf5',
  },
  addRow: {
    flexDirection: 'row',
    padding: 12,
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
});
