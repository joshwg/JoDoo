import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as db from '../db';
import { Task, TodoList } from '../types';
import TaskCard from './TaskCard';
import TaskEditorModal from './TaskEditorModal';

export default function TodoSection() {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [renamingList, setRenamingList] = useState<TodoList | null>(null);
  const [renameText, setRenameText] = useState('');

  const refreshLists = useCallback((preferId?: number) => {
    const all = db.getLists();
    setLists(all);
    setActiveListId((current) => {
      const want = preferId ?? current;
      return all.some((l) => l.id === want) ? want! : all[0]?.id ?? null;
    });
  }, []);

  const refreshTasks = useCallback((listId: number | null) => {
    setTasks(listId == null ? [] : db.getTasks(listId));
  }, []);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    refreshTasks(activeListId);
  }, [activeListId, refreshTasks]);

  const activeList = lists.find((l) => l.id === activeListId) ?? null;

  // ----- tab actions -----

  const addList = () => {
    const created = db.createList();
    refreshLists(created.id);
  };

  const openRename = (list: TodoList) => {
    setRenamingList(list);
    setRenameText(list.name);
  };

  const commitRename = () => {
    if (renamingList && renameText.trim()) {
      db.renameList(renamingList.id, renameText);
      refreshLists();
    }
    setRenamingList(null);
  };

  const confirmDeleteList = (list: TodoList) => {
    setRenamingList(null);
    Alert.alert('Delete list', `Delete "${list.name}" and all of its tasks?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          db.deleteList(list.id);
          refreshLists();
        },
      },
    ]);
  };

  // ----- task actions -----

  const saveTask = (title: string, description: string, dueDate: string | null) => {
    if (activeListId == null) return;
    if (editingTask) {
      db.updateTask(editingTask.id, title, description, dueDate);
    } else {
      db.createTask(activeListId, title, description, dueDate);
    }
    setEditorVisible(false);
    setEditingTask(null);
    refreshTasks(activeListId);
  };

  const toggleDone = (task: Task) => {
    db.setTaskDone(task.id, !task.done);
    refreshTasks(activeListId);
  };

  const deleteTask = (task: Task) => {
    Alert.alert('Delete task', `Delete "${task.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          db.deleteTask(task.id);
          refreshTasks(activeListId);
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Tab strip: one tab per list plus a "+" tab that creates a new list. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabStrip}
        contentContainerStyle={styles.tabStripContent}
      >
        {lists.map((list) => (
          <Pressable
            key={list.id}
            onPress={() => setActiveListId(list.id)}
            onLongPress={() => openRename(list)}
            style={[styles.tab, list.id === activeListId && styles.tabActive]}
          >
            <Text
              style={[styles.tabText, list.id === activeListId && styles.tabTextActive]}
              numberOfLines={1}
            >
              {list.name}
            </Text>
          </Pressable>
        ))}
        <Pressable onPress={addList} style={styles.tab} accessibilityLabel="Add list">
          <Text style={styles.plusTab}>+</Text>
        </Pressable>
      </ScrollView>

      {/* Header with the "+" button at the top of the list for new tasks. */}
      <View style={styles.listHeader}>
        <Text style={styles.listTitle} numberOfLines={1}>
          {activeList?.name ?? ''}
        </Text>
        <Pressable
          onPress={() => {
            setEditingTask(null);
            setEditorVisible(true);
          }}
          style={styles.addTaskButton}
          accessibilityLabel="Add task"
        >
          <Text style={styles.addTaskPlus}>+</Text>
        </Pressable>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(t) => String(t.id)}
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            onToggleDone={toggleDone}
            onEdit={(t) => {
              setEditingTask(t);
              setEditorVisible(true);
            }}
            onDelete={deleteTask}
          />
        )}
        contentContainerStyle={styles.taskListContent}
        ListEmptyComponent={
          <Text style={styles.empty}>No tasks yet. Tap + to add one.</Text>
        }
      />

      <TaskEditorModal
        visible={editorVisible}
        task={editingTask}
        onSave={saveTask}
        onCancel={() => {
          setEditorVisible(false);
          setEditingTask(null);
        }}
      />

      {/* Rename / delete list dialog (opened by long-pressing a tab). */}
      <Modal
        visible={renamingList != null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenamingList(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.renameSheet}>
            <Text style={styles.renameHeading}>Rename list</Text>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.renameActions}>
              <Pressable
                onPress={() => renamingList && confirmDeleteList(renamingList)}
                style={styles.renameButton}
              >
                <Text style={styles.deleteText}>Delete</Text>
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
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fffdf5',
  },
  listTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#222',
  },
  addTaskButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1a5fb4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTaskPlus: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: 'bold',
  },
  taskListContent: {
    paddingBottom: 24,
    paddingTop: 4,
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    color: '#999',
    fontSize: 14,
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
});
