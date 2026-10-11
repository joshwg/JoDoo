import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

interface Props {
  visible: boolean;
  /** What a line becomes, for the hint text: "task" or "item". */
  noun: string;
  /** Receives the raw text; the caller parses and creates the list. */
  onImport: (text: string) => void;
  onClose: () => void;
}

/**
 * "Import List" (on the "+" menu): paste or type a list as plain text, one
 * line per item. Accepts Jodoo's own Export format back (checkbox glyphs,
 * amounts, due dates, first line as the name) as well as any plain lines.
 */
export default function ImportListModal({ visible, noun, onImport, onClose }: Props) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const paste = async () => {
    try {
      const clip = await Clipboard.getStringAsync();
      if (clip) setText(clip);
    } catch {
      // Clipboard unavailable - the user can still type.
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior="padding">
        <View style={styles.sheet}>
          <Text style={styles.heading}>Import List</Text>
          <Text style={styles.hint}>
            One line per {noun}. A pasted Jodoo export keeps its name, check marks and details.
          </Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder={'Paste a list here'}
            textAlignVertical="top"
          />
          <View style={styles.actions}>
            <Pressable onPress={paste} style={styles.button}>
              <Text style={styles.pasteText}>Paste</Text>
            </Pressable>
            <View style={styles.spacer} />
            <Pressable onPress={onClose} style={styles.button}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onImport(text)}
              style={styles.button}
              disabled={!text.trim()}
            >
              <Text style={[styles.importText, !text.trim() && styles.importDisabled]}>
                Import
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  hint: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#222',
    height: 180,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  spacer: {
    flex: 1,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  pasteText: {
    color: '#1a5fb4',
    fontSize: 15,
    fontWeight: '600',
  },
  cancelText: {
    color: '#666',
    fontSize: 15,
  },
  importText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 15,
  },
  importDisabled: {
    color: '#aaa',
  },
});
