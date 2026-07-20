import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as db from '../db';
import { subscribeRemoteUpdate } from '../remoteUpdates';
import { createShare, fetchShare } from '../syncClient';
import { pushTodoListIfShared, refreshSyncConnections } from '../syncManager';
import { Task, TodoList } from '../types';
import EnterKeyModal from './EnterKeyModal';
import ListTab from './ListTab';
import ServerSettingsModal from './ServerSettingsModal';
import ShareKeyModal from './ShareKeyModal';
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
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [joinVisible, setJoinVisible] = useState(false);
  const [serverSettingsVisible, setServerSettingsVisible] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareKeyShown, setShareKeyShown] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverListId, setDragOverListId] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingListId, setDraggingListId] = useState<number | null>(null);

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

  // Live-refresh when another peer updates a shared list we're viewing.
  useEffect(
    () =>
      subscribeRemoteUpdate((target) => {
        if (target.type !== 'todo') return;
        refreshLists();
        refreshTasks(activeListId);
      }),
    [refreshLists, refreshTasks, activeListId]
  );

  const activeList = lists.find((l) => l.id === activeListId) ?? null;

  // Keep a ref of the latest task list so drag handlers (created once inside
  // PanResponder-driven callbacks) always see fresh data.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // ----- drag-and-drop: move between lists (drop on a tab) or reorder within a list -----

  type Rect = { x: number; y: number; width: number; height: number };
  const tabRefs = useRef(new Map<number, View>()).current;
  const tabRectsRef = useRef(new Map<number, Rect>()).current;
  const taskRefs = useRef(new Map<number, View>()).current;
  const taskRectsRef = useRef(new Map<number, Rect>()).current;
  // Band (page-Y range) covered by the tab strip, used to gate auto-scroll so
  // it only kicks in while the drag is actually up near the tabs.
  const tabStripBandRef = useRef<{ top: number; bottom: number } | null>(null);

  // Auto-scroll the horizontal tab strip while dragging near a screen edge,
  // so tabs that are currently scrolled off-screen can still be reached.
  const tabScrollViewRef = useRef<ScrollView>(null);
  const tabScrollXRef = useRef(0);
  const dragPageRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const AUTOSCROLL_EDGE = 48;
  const AUTOSCROLL_STEP = 16;

  // Auto-scroll the task list vertically while dragging near its top/bottom
  // edge, so tasks currently scrolled off-screen can still be reached.
  const taskListContainerRef = useRef<View>(null);
  const taskListRectRef = useRef<Rect | null>(null);
  const taskListRef = useRef<FlatList<Task>>(null);
  const taskScrollYRef = useRef(0);

  const measureTabs = useCallback(() => {
    tabRefs.forEach((view, listId) => {
      view.measureInWindow((x, y, width, height) => {
        tabRectsRef.set(listId, { x, y, width, height });
        const band = tabStripBandRef.current;
        tabStripBandRef.current = {
          top: band ? Math.min(band.top, y) : y,
          bottom: band ? Math.max(band.bottom, y + height) : y + height,
        };
      });
    });
  }, [tabRefs, tabRectsRef]);

  const measureDragTargets = useCallback(() => {
    measureTabs();
    taskRefs.forEach((view, taskId) => {
      view.measureInWindow((x, y, width, height) => {
        taskRectsRef.set(taskId, { x, y, width, height });
      });
    });
    taskListContainerRef.current?.measureInWindow((x, y, width, height) => {
      taskListRectRef.current = { x, y, width, height };
    });
  }, [measureTabs, taskRefs, taskRectsRef]);

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

      const band = tabStripBandRef.current;
      if (band && point.y >= band.top - 20 && point.y <= band.bottom + 60) {
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
      }

      const listRect = taskListRectRef.current;
      if (listRect) {
        let vDelta = 0;
        if (point.y < listRect.y + AUTOSCROLL_EDGE) vDelta = -AUTOSCROLL_STEP;
        else if (point.y > listRect.y + listRect.height - AUTOSCROLL_EDGE) vDelta = AUTOSCROLL_STEP;
        if (vDelta !== 0) {
          const newY = Math.max(0, taskScrollYRef.current + vDelta);
          taskListRef.current?.scrollToOffset({ offset: newY, animated: false });
          // Card positions shifted, so re-measure them for accurate drop hit-testing.
          taskRefs.forEach((view, taskId) => {
            view.measureInWindow((x, y, width, height) => {
              taskRectsRef.set(taskId, { x, y, width, height });
            });
          });
        }
      }
    }, 32);
  }, [stopAutoScroll, measureTabs, taskRefs, taskRectsRef]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const handleDragStart = useCallback(
    (task: Task) => {
      measureDragTargets();
      setDraggingTaskId(task.id);
      setDragOverListId(null);
      setDragOverIndex(null);
      startAutoScroll();
    },
    [measureDragTargets, startAutoScroll]
  );

  const handleDragMove = useCallback((_task: Task, pageX: number, pageY: number) => {
    dragPageRef.current = { x: pageX, y: pageY };

    let overList: number | null = null;
    for (const [listId, rect] of tabRectsRef) {
      if (
        pageX >= rect.x &&
        pageX <= rect.x + rect.width &&
        pageY >= rect.y &&
        pageY <= rect.y + rect.height
      ) {
        overList = listId;
        break;
      }
    }
    setDragOverListId(overList);

    if (overList != null) {
      setDragOverIndex(null);
      return;
    }

    const currentTasks = tasksRef.current;
    let index = currentTasks.length;
    for (let i = 0; i < currentTasks.length; i++) {
      const rect = taskRectsRef.get(currentTasks[i].id);
      if (!rect) continue;
      if (pageY < rect.y + rect.height / 2) {
        index = i;
        break;
      }
    }
    setDragOverIndex(index);
  }, [tabRectsRef, taskRectsRef]);

  const handleDragEnd = useCallback(
    (task: Task) => {
      stopAutoScroll();
      dragPageRef.current = null;
      setDraggingTaskId(null);
      setDragOverListId(null);
      setDragOverIndex(null);

      if (dragOverListId != null && dragOverListId !== task.listId) {
        db.moveTaskToList(task.id, dragOverListId);
        refreshTasks(activeListIdRef.current);
        pushTodoListIfShared(task.listId);
        pushTodoListIfShared(dragOverListId);
        return;
      }

      if (dragOverIndex != null && activeListIdRef.current != null) {
        const current = tasksRef.current;
        const originalIndex = current.findIndex((t) => t.id === task.id);
        const withoutDragged = current.filter((t) => t.id !== task.id);
        let insertAt = dragOverIndex;
        if (originalIndex !== -1 && originalIndex < dragOverIndex) insertAt -= 1;
        insertAt = Math.max(0, Math.min(insertAt, withoutDragged.length));
        withoutDragged.splice(insertAt, 0, task);
        const orderedIds = withoutDragged.map((t) => t.id);
        db.reorderTasks(activeListIdRef.current, orderedIds);
        refreshTasks(activeListIdRef.current);
        pushTodoListIfShared(activeListIdRef.current);
      }
    },
    [dragOverListId, dragOverIndex, refreshTasks, stopAutoScroll]
  );

  // ----- drag-and-drop: reorder the lists (tabs) themselves -----

  const handleListDragStart = useCallback(
    (list: TodoList) => {
      measureTabs();
      setDraggingListId(list.id);
      setDragOverListId(null);
      startAutoScroll();
    },
    [measureTabs, startAutoScroll]
  );

  const handleListDragMove = useCallback((_list: TodoList, pageX: number, pageY: number) => {
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

  const handleListDragEnd = useCallback(
    (list: TodoList) => {
      stopAutoScroll();
      dragPageRef.current = null;
      setDraggingListId(null);
      const overId = dragOverListId;
      setDragOverListId(null);

      if (overId != null && overId !== list.id) {
        const current = listsRef.current;
        const withoutDragged = current.filter((l) => l.id !== list.id);
        const targetIndex = withoutDragged.findIndex((l) => l.id === overId);
        const insertAt = targetIndex === -1 ? withoutDragged.length : targetIndex;
        withoutDragged.splice(insertAt, 0, list);
        db.reorderLists(withoutDragged.map((l) => l.id));
        refreshLists(list.id);
      }
    },
    [dragOverListId, refreshLists, stopAutoScroll]
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
    const created = db.createList();
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

  const joinSharedList = async (key: string) => {
    const snapshot = await fetchShare(key);
    if (snapshot.kind !== 'todo') {
      throw new Error('That key belongs to a shopping list, not a todo list.');
    }
    // Rejoining a share this device already has (e.g. retrying after a
    // partial failure) must neither create a duplicate list nor force-apply
    // the snapshot over local edits the live sync path hasn't pushed yet -
    // the reopened connection arbitrates content properly.
    const existing = db.getLists().find((l) => l.shareKey === key);
    let targetId: number;
    if (existing) {
      targetId = existing.id;
    } else {
      const name = snapshot.name || 'Shared List';
      const created = db.createJoinedList(name, key);
      db.applySyncedTasks(
        created.id,
        name,
        snapshot.items as unknown as db.SyncTaskItem[],
        snapshot.version
      );
      targetId = created.id;
    }
    refreshLists(targetId);
    await refreshSyncConnections();
    setJoinVisible(false);
  };

  const openRename = (list: TodoList) => {
    setRenamingList(list);
    setRenameText(list.name);
  };

  const commitRename = () => {
    if (renamingList && renameText.trim()) {
      db.renameList(renamingList.id, renameText);
      pushTodoListIfShared(renamingList.id);
      refreshLists();
    }
    setRenamingList(null);
  };

  const shareList = async (list: TodoList) => {
    if (list.shareKey) {
      setRenamingList(null);
      setShareKeyShown(list.shareKey);
      return;
    }
    setShareBusy(true);
    try {
      const snapshot = await createShare('todo', list.name, db.getTasksAsSyncItems(list.id) as unknown as Record<string, unknown>[]);
      db.setListShareKey(list.id, snapshot.key, snapshot.version);
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
          refreshSyncConnections();
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
    pushTodoListIfShared(activeListId);
  };

  const toggleDone = (task: Task) => {
    db.setTaskDone(task.id, !task.done);
    refreshTasks(activeListId);
    pushTodoListIfShared(task.listId);
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
          pushTodoListIfShared(task.listId);
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Tab strip: one tab per list plus a "+" tab that creates or joins a list.
          Enlarges while a task is being dragged so it's an easier drop target. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        ref={tabScrollViewRef}
        onScroll={(e) => {
          tabScrollXRef.current = e.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={32}
        style={[styles.tabStrip, draggingTaskId != null && styles.tabStripDragging]}
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
            dragHitSlop={draggingTaskId != null ? 12 : 0}
            style={[
              styles.tab,
              list.id === activeListId && styles.tabActive,
              draggingTaskId != null && list.id !== activeListId && styles.tabDropTarget,
              dragOverListId === list.id && styles.tabDragOver,
            ]}
            textStyle={[styles.tabText, list.id === activeListId && styles.tabTextActive]}
            onSelect={() => setActiveListId(list.id)}
            onRename={() => openRename(list)}
            onDragStart={handleListDragStart}
            onDragMove={handleListDragMove}
            onDragEnd={handleListDragEnd}
          />
        ))}
        <Pressable onPress={openAddMenu} style={styles.tab} accessibilityLabel="Add list">
          <Text style={styles.plusTab}>+</Text>
        </Pressable>
      </ScrollView>

      {/* Header + task list: a one-finger horizontal slide here switches lists. */}
      <View style={styles.swipeArea} {...panResponder.panHandlers}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle} numberOfLines={1}>
            {activeList?.name ?? ''}
          </Text>
          <Pressable
            onPress={() => setServerSettingsVisible(true)}
            hitSlop={8}
            accessibilityLabel="Server settings"
            style={styles.settingsButton}
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </Pressable>
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

        <View style={styles.taskListWrapper} ref={taskListContainerRef}>
          <FlatList
            data={tasks}
            keyExtractor={(t) => String(t.id)}
            scrollEnabled={draggingTaskId == null}
            ref={taskListRef}
            onScroll={(e) => {
              taskScrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={32}
            renderItem={({ item, index }) => (
              <View
                ref={(r) => {
                  if (r) taskRefs.set(item.id, r);
                  else taskRefs.delete(item.id);
                }}
                style={[
                  dragOverIndex === index &&
                    draggingTaskId != null &&
                    draggingTaskId !== item.id &&
                    styles.dropIndicatorAbove,
                  draggingTaskId === item.id && styles.draggedRow,
                ]}
              >
                <TaskCard
                  task={item}
                  dragging={draggingTaskId === item.id}
                  onToggleDone={toggleDone}
                  onEdit={(t) => {
                    setEditingTask(t);
                    setEditorVisible(true);
                  }}
                  onDelete={deleteTask}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                />
              </View>
            )}
            contentContainerStyle={styles.taskListContent}
            ListEmptyComponent={
              <Text style={styles.empty}>No tasks yet. Tap + to add one.</Text>
            }
          />
        </View>
      </View>

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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
        <Pressable style={styles.menuBackdrop} onPress={() => setAddMenuVisible(false)}>
          <View style={styles.addMenu}>
            <Pressable style={styles.menuItem} onPress={startNewList}>
              <Text style={styles.menuText}>New List</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={startJoinList}>
              <Text style={styles.menuText}>Join Shared List</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <EnterKeyModal
        visible={joinVisible}
        title="Join Shared List"
        body="Enter the share key someone gave you to add their todo list here."
        onCancel={() => setJoinVisible(false)}
        onSubmit={joinSharedList}
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
  tabStripDragging: {
    paddingVertical: 4,
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
  settingsButton: {
    padding: 4,
    marginRight: 8,
  },
  settingsIcon: {
    fontSize: 20,
    color: '#555',
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
  taskListWrapper: {
    flex: 1,
  },
  taskListContent: {
    paddingBottom: 24,
    paddingTop: 4,
  },
  dropIndicatorAbove: {
    borderTopWidth: 3,
    borderTopColor: '#1a5fb4',
  },
  draggedRow: {
    zIndex: 10,
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
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ddd',
  },
});
