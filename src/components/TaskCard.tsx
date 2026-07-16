import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { postItColor } from '../colors';
import { formatIso, isOverdue } from '../dates';
import { Task } from '../types';

interface Props {
  task: Task;
  onToggleDone: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

/**
 * Post-It style card: bold title, first line of the description visible by
 * default; tapping the card expands the full description.
 */
export default function TaskCard({ task, onToggleDone, onEdit, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      onPress={() => setExpanded((e) => !e)}
      onLongPress={() => onEdit(task)}
      style={[styles.card, { backgroundColor: postItColor(task.colorIndex) }]}
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
        <Text style={[styles.title, task.done && styles.doneText]} numberOfLines={expanded ? undefined : 1}>
          {task.title}
        </Text>
        <Pressable onPress={() => onDelete(task)} hitSlop={8} accessibilityLabel="Delete task">
          <Text style={styles.delete}>✕</Text>
        </Pressable>
      </View>

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
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#222',
  },
  delete: {
    fontSize: 16,
    color: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 4,
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
