import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as db from '../db';
import { DictionaryEntry } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Editor for the autocomplete dictionary. The text box doubles as a filter
 * and as the input for adding a new entry.
 */
export default function DictionaryModal({ visible, onClose }: Props) {
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [editing, setEditing] = useState<DictionaryEntry | null>(null);
  const [editText, setEditText] = useState('');

  const refresh = useCallback((f: string) => setEntries(db.getDictionary(f)), []);

  useEffect(() => {
    if (visible) {
      setFilter('');
      refresh('');
    }
  }, [visible, refresh]);

  const changeFilter = (text: string) => {
    setFilter(text);
    refresh(text);
  };

  const add = () => {
    if (!filter.trim()) return;
    db.addDictionaryEntry(filter);
    changeFilter('');
  };

  const commitEdit = () => {
    if (editing) {
      db.editDictionaryEntry(editing.id, editText);
      refresh(filter);
    }
    setEditing(null);
  };

  const remove = (entry: DictionaryEntry) => {
    Alert.alert('Delete entry', `Delete "${entry.name}" from the dictionary?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          db.deleteDictionaryEntry(entry.id);
          refresh(filter);
        },
      },
    ]);
  };

  const resetAll = () => {
    Alert.alert(
      'Restore default dictionary',
      'Delete all entries and restore the built-in dictionary? Your added items and usage counts will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: () => {
            db.resetDictionary();
            changeFilter('');
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.heading}>Dictionary</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="Search or add an item…"
            value={filter}
            onChangeText={changeFilter}
            onSubmitEditing={add}
            returnKeyType="done"
          />
          <Pressable onPress={add} style={styles.addButton} accessibilityLabel="Add entry">
            <Text style={styles.addPlus}>+</Text>
          </Pressable>
        </View>

        <Text style={styles.count}>
          {entries.length} item{entries.length === 1 ? '' : 's'}
        </Text>

        <FlatList
          data={entries}
          keyExtractor={(e) => String(e.id)}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() => {
                  setEditing(item);
                  setEditText(item.name);
                }}
              >
                <Text style={styles.rowText}>{item.name}</Text>
                {item.uses > 0 && <Text style={styles.uses}>used {item.uses}×</Text>}
              </Pressable>
              <Pressable onPress={() => remove(item)} hitSlop={8} accessibilityLabel="Delete entry">
                <Text style={styles.delete}>✕</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No matching items. Press + to add "{filter.trim()}".</Text>
          }
        />

        <Pressable onPress={resetAll} style={styles.resetButton}>
          <Text style={styles.resetText}>Delete All & Restore Defaults</Text>
        </Pressable>

        {/* Edit dialog */}
        <Modal
          visible={editing != null}
          transparent
          animationType="fade"
          onRequestClose={() => setEditing(null)}
        >
          <KeyboardAvoidingView
            style={styles.backdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.editSheet}>
              <Text style={styles.editHeading}>Edit entry</Text>
              <TextInput
                style={styles.input}
                value={editText}
                onChangeText={setEditText}
                autoFocus
                selectTextOnFocus
              />
              <View style={styles.editActions}>
                <Pressable onPress={() => setEditing(null)} style={styles.editButton}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={commitEdit} style={styles.editButton}>
                  <Text style={styles.saveText}>Save</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fffdf5',
    paddingTop: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  heading: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#222',
  },
  close: {
    fontSize: 16,
    color: '#1a5fb4',
    fontWeight: '600',
  },
  addRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
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
  count: {
    fontSize: 12,
    color: '#999',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowText: {
    fontSize: 15,
    color: '#222',
  },
  uses: {
    fontSize: 11,
    color: '#999',
  },
  delete: {
    fontSize: 15,
    color: '#bbb',
    paddingHorizontal: 4,
  },
  empty: {
    textAlign: 'center',
    marginTop: 32,
    color: '#999',
    fontSize: 14,
    paddingHorizontal: 24,
  },
  resetButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  resetText: {
    color: '#c0392b',
    fontSize: 15,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  editSheet: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  editHeading: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#222',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 8,
  },
  editButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
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
});
