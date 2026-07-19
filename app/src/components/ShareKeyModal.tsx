import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  visible: boolean;
  shareKey: string | null;
  onClose: () => void;
}

/** Shows a share key as selectable text so the owner can copy it (long-press
 *  to select, then use the OS's copy action) and pass it along out-of-band. */
export default function ShareKeyModal({ visible, shareKey, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>List Shared</Text>
          <Text style={styles.body}>
            Give this key to the other person. In their app, choose "Join Shared List" and enter
            it there.
          </Text>
          <Text style={styles.key} selectable>
            {shareKey}
          </Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
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
    padding: 20,
    alignItems: 'center',
  },
  heading: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#222',
  },
  body: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
  key: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a5fb4',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  closeButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  closeText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
