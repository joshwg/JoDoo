import React, { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { postItColor } from '../colors';
import { formatIso, isOverdue } from '../dates';
import { Task } from '../types';

const DOUBLE_TAP_MS = 300;

interface Props {
  task: Task;
  onToggleDone: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** Drag lifecycle, driven by the drag handle. Coordinates are page-absolute. */
  onDragStart?: (task: Task) => void;
  onDragMove?: (task: Task, pageX: number, pageY: number) => void;
  onDragEnd?: (task: Task, pageX: number, pageY: number) => void;
  /** True while this specific card is the one currently being dragged. */
  dragging?: boolean;
}

/**
 * Post-It style card: bold title, first line of the description visible by
 * default; single tap expands/collapses the full description, double tap (or
 * the pencil icon) opens the editor. The handle on the right initiates
 * drag-and-drop (reorder within the list, or drop on a tab to move lists).
 */
export default function TaskCard({
  task,
  onToggleDone,
  onEdit,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
  dragging,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const lastTapRef = useRef(0);
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Refs so the PanResponder (created once) always sees the latest props.
  const taskRef = useRef(task);
  taskRef.current = task;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      onEdit(task);
    } else {
      lastTapRef.current = now;
      setExpanded((e) => !e);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Once a drag has begun, never let an ancestor (e.g. the swipe-to-switch-list
      // gesture) steal the responder just because the finger moves sideways.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        pan.setValue({ x: 0, y: 0 });
        onDragStartRef.current?.(taskRef.current);
      },
      onPanResponderMove: (evt, gestureState) => {
        pan.setValue({ x: gestureState.dx, y: gestureState.dy });
        onDragMoveRef.current?.(taskRef.current, evt.nativeEvent.pageX, evt.nativeEvent.pageY);
      },
      onPanResponderRelease: (evt) => {
        onDragEndRef.current?.(taskRef.current, evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: (evt) => {
        onDragEndRef.current?.(taskRef.current, evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
      },
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: postItColor(task.colorIndex) },
        dragging && styles.dragging,
        { transform: pan.getTranslateTransform() },
      ]}
    >
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => onToggleDone(task)}
          style={styles.checkbox}
          hitSlop={8}
          accessibilityLabel={task.done ? 'Mark not done' : 'Mark done'}
        >
          <Text style={styles.checkboxMark}>{task.done ? '✓' : ''}</Text>
        </Pressable>
        <Pressable onPress={handleTap} style={styles.titleTapArea}>
          <Text style={[styles.title, task.done && styles.doneText]} numberOfLines={expanded ? undefined : 1}>
            {task.title}
          </Text>
        </Pressable>
        <Pressable onPress={() => onEdit(task)} hitSlop={8} style={styles.iconButton} accessibilityLabel="Edit task">
          <Text style={styles.editIcon}>✎</Text>
        </Pressable>
        <Pressable onPress={() => onDelete(task)} hitSlop={8} style={styles.iconButton} accessibilityLabel="Delete task">
          <Text style={styles.delete}>✕</Text>
        </Pressable>
        <View
          {...panResponder.panHandlers}
          style={styles.dragHandle}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Drag to reorder or move task"
        >
          <Text style={styles.dragHandleIcon}>☰</Text>
        </View>
      </View>

      <Pressable onPress={handleTap}>
        {task.description.length > 0 && (
          <Text
            style={[styles.description, task.done && styles.doneText]}
            numberOfLines={expanded ? undefined : 1}
          >
            {task.description}
          </Text>
        )}

        {task.dueDate && (
          <Text style={[styles.due, !task.done && isOverdue(task.dueDate) && styles.overdue]}>
            Due {formatIso(task.dueDate)}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 4,
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 6,
    // Post-It feel: soft drop shadow, slightly squared corners.
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 1, height: 2 },
  },
  dragging: {
    elevation: 12,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    opacity: 0.95,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  checkboxMark: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  titleTapArea: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#222',
  },
  iconButton: {
    paddingHorizontal: 2,
  },
  editIcon: {
    fontSize: 16,
    color: 'rgba(0,0,0,0.45)',
  },
  delete: {
    fontSize: 16,
    color: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 4,
  },
  dragHandle: {
    paddingLeft: 6,
    paddingVertical: 2,
  },
  dragHandleIcon: {
    fontSize: 16,
    color: 'rgba(0,0,0,0.35)',
  },
  description: {
    marginTop: 6,
    marginLeft: 30,
    fontSize: 14,
    color: '#333',
  },
  due: {
    marginTop: 6,
    marginLeft: 30,
    fontSize: 12,
    color: 'rgba(0,0,0,0.55)',
  },
  overdue: {
    color: '#B00020',
    fontWeight: '600',
  },
  doneText: {
    textDecorationLine: 'line-through',
    color: 'rgba(0,0,0,0.4)',
  },
});
