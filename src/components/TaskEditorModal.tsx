import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatIso, fromIso, todayIso, toIso } from '../dates';
import { Task } from '../types';

interface Props {
  visible: boolean;
  /** Task being edited, or null when adding a new one. */
  task: Task | null;
  onSave: (title: string, description: string, dueDate: string | null) => void;
  onCancel: () => void;
}

export default function TaskEditorModal({ visible, task, onSave, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(todayIso());
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle(task?.title ?? '');
      setDescription(task?.description ?? '');
      // Due date is optional but defaults to today for new tasks.
      setDueDate(task ? task.dueDate : todayIso());
      setShowPicker(false);
    }
  }, [visible, task]);

  const canSave = title.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>{task ? 'Edit Task' : 'New Task'}</Text>

          <TextInput
            style={styles.input}
            placeholder="Title"
            value={title}
            onChangeText={setTitle}
            autoFocus
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Description (optional)"
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <View style={styles.dateRow}>
            <Pressable onPress={() => setShowPicker(true)} style={styles.dateButton}>
              <Text style={styles.dateText}>
                {dueDate ? `📅 ${formatIso(dueDate)}` : '📅 No due date'}
              </Text>
            </Pressable>
            {dueDate ? (
              <Pressable onPress={() => setDueDate(null)} hitSlop={8}>
                <Text style={styles.clearDate}>Clear</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setDueDate(todayIso())} hitSlop={8}>
                <Text style={styles.clearDate}>Set today</Text>
              </Pressable>
            )}
          </View>

          {showPicker && (
            <DateTimePicker
              value={dueDate ? fromIso(dueDate) : new Date()}
              mode="date"
              display="calendar"
              onChange={(event, date) => {
                setShowPicker(false);
                if (event.type === 'set' && date) setDueDate(toIso(date));
              }}
            />
          )}

          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.actionButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => canSave && onSave(title, description, dueDate)}
              style={[styles.actionButton, !canSave && styles.disabled]}
            >
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  heading: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#222',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    marginBottom: 10,
    color: '#222',
  },
  multiline: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dateButton: {
    paddingVertical: 6,
  },
  dateText: {
    fontSize: 15,
    color: '#1a5fb4',
  },
  clearDate: {
    fontSize: 13,
    color: '#888',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  disabled: {
    opacity: 0.4,
  },
  cancelText: {
    fontSize: 15,
    color: '#666',
  },
  saveText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1a5fb4',
  },
});
