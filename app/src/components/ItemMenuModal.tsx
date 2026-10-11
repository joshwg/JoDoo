import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTextSettings } from '../textSettings';

interface PickerList {
  id: number;
  name: string;
}

export interface ItemMenuAction {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  /** Heading - usually the item's name. */
  title: string;
  /** Extra actions shown above "Move to" (e.g. Cross off, Delete). */
  actions: ItemMenuAction[];
  /** Move/copy destinations; pass the item's current list excluded. */
  lists: PickerList[];
  onPick: (listId: number) => void;
  /** When set, a "Copy to…" entry appears alongside "Move to…". */
  onPickCopy?: (listId: number) => void;
  onClose: () => void;
}

/**
 * The long-press menu for a task or shopping item: section-specific actions
 * plus "Move to", which flips the sheet to a second level enumerating the
 * other lists. This replaced the long-press drag-onto-tab gesture, which
 * was too easy to fumble on a touch screen.
 */
export default function ItemMenuModal({
  visible,
  title,
  actions,
  lists,
  onPick,
  onPickCopy,
  onClose,
}: Props) {
  const [view, setView] = useState<'root' | 'move' | 'copy'>('root');
  const { fontFamily, fontSize } = useTextSettings();

  // Every open starts back at the first level.
  useEffect(() => {
    if (visible) setView('root');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Inner pressable swallows taps so touching the sheet doesn't close it. */}
        <Pressable style={styles.sheet}>
          <Text style={[styles.heading, { fontFamily }]} numberOfLines={1}>
            {title}
          </Text>

          {view === 'root' ? (
            <>
              {actions.map((a) => (
                <Pressable
                  key={a.label}
                  style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                  onPress={a.onPress}
                >
                  <Text style={[styles.optionText, a.destructive && styles.destructiveText]}>
                    {a.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                onPress={() => setView('move')}
              >
                <Text style={styles.optionText}>Move to…</Text>
              </Pressable>
              {onPickCopy && (
                <Pressable
                  style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                  onPress={() => setView('copy')}
                >
                  <Text style={styles.optionText}>Copy to…</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text style={styles.subheading}>{view === 'move' ? 'Move to' : 'Copy to'}</Text>
              {lists.length === 0 && (
                <Text style={styles.empty}>There is no other list — create one first.</Text>
              )}
              <ScrollView style={styles.destinations}>
                {lists.map((l) => (
                  <Pressable
                    key={l.id}
                    style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                    onPress={() => (view === 'move' ? onPick(l.id) : onPickCopy?.(l.id))}
                  >
                    <Text style={[styles.optionText, { fontFamily, fontSize }]} numberOfLines={1}>
                      {l.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

          <Pressable
            onPress={view === 'root' ? onClose : () => setView('root')}
            style={styles.cancel}
            hitSlop={8}
          >
            <Text style={styles.cancelText}>{view === 'root' ? 'Cancel' : 'Back'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
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
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
    color: '#222',
  },
  subheading: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
    marginBottom: 2,
  },
  empty: {
    fontSize: 14,
    color: '#666',
    marginVertical: 8,
  },
  destinations: {
    maxHeight: 300,
  },
  option: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  optionPressed: {
    backgroundColor: '#e8f0fb',
  },
  optionText: {
    fontSize: 15,
    color: '#1a5fb4',
    fontWeight: '600',
  },
  destructiveText: {
    color: '#B00020',
  },
  cancel: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  cancelText: {
    color: '#666',
    fontSize: 15,
  },
});
