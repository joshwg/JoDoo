import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

interface Props {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (key: string) => Promise<void> | void;
}

/** Generic "enter a 20-character share key" prompt, used both for joining a
 *  todo list and for becoming a peer on the shared shopping list. */
export default function EnterKeyModal({
  visible,
  title,
  body,
  confirmLabel = 'Join',
  onCancel,
  onSubmit,
}: Props) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setKey('');
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const submit = async () => {
    const trimmed = key.trim().toLowerCase();
    if (!trimmed) {
      setError('Enter a share key.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>{title}</Text>
          {body && <Text style={styles.body}>{body}</Text>}
          <TextInput
            style={styles.input}
            value={key}
            onChangeText={setKey}
            placeholder="20-character share key"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          {error && <Text style={styles.error}>{error}</Text>}
          {busy && <ActivityIndicator style={styles.spinner} />}
          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.button} disabled={busy}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <View style={styles.spacer} />
            <Pressable onPress={submit} style={styles.button} disabled={busy}>
              <Text style={styles.confirmText}>{confirmLabel}</Text>
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
    fontSize: 16,
    fontWeight: 'bold',
    color: '#222',
  },
  body: {
    fontSize: 13,
    color: '#666',
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#222',
    marginTop: 12,
  },
  error: {
    color: '#B00020',
    fontSize: 13,
    marginTop: 8,
  },
  spinner: {
    marginTop: 12,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  spacer: {
    flex: 1,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelText: {
    color: '#666',
    fontSize: 15,
  },
  confirmText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
