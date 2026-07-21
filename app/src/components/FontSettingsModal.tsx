import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  FONT_FAMILY_OPTIONS,
  fontFamilyStyle,
  getFontFamily,
  getFontSize,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  setFontFamily,
  setFontSize,
} from '../textSettings';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** Lets the user pick the font family and size used for task and shopping
 *  item text. Device-local; applies immediately as each option is tapped. */
export default function FontSettingsModal({ visible, onClose }: Props) {
  // Re-read on every render (cheap, synchronous SQLite) so the checkmarks
  // stay in sync as the user taps around.
  const currentFamily = getFontFamily();
  const currentSize = getFontSize();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>Text Appearance</Text>

          <Text style={styles.label}>Font</Text>
          {FONT_FAMILY_OPTIONS.map((family) => (
            <Pressable
              key={family}
              style={styles.option}
              onPress={() => setFontFamily(family)}
            >
              <Text style={styles.optionCheck}>{family === currentFamily ? '✓' : ''}</Text>
              <Text style={[styles.optionText, { fontFamily: fontFamilyStyle(family) }]}>
                {family === 'System' ? 'Default' : family}
              </Text>
            </Pressable>
          ))}

          <Text style={styles.label}>Size</Text>
          <View style={styles.sizeStepper}>
            <Pressable
              onPress={() => setFontSize(currentSize - 1)}
              hitSlop={8}
              disabled={currentSize <= MIN_FONT_SIZE}
              accessibilityLabel="Decrease font size"
            >
              <Text style={[styles.sizeBtn, currentSize <= MIN_FONT_SIZE && styles.sizeBtnDisabled]}>
                −
              </Text>
            </Pressable>
            <Text style={[styles.sizePreview, { fontSize: currentSize }]}>{currentSize}pt</Text>
            <Pressable
              onPress={() => setFontSize(currentSize + 1)}
              hitSlop={8}
              disabled={currentSize >= MAX_FONT_SIZE}
              accessibilityLabel="Increase font size"
            >
              <Text style={[styles.sizeBtn, currentSize >= MAX_FONT_SIZE && styles.sizeBtnDisabled]}>
                +
              </Text>
            </Pressable>
          </View>

          <Pressable onPress={onClose} style={styles.doneButton}>
            <Text style={styles.doneText}>Done</Text>
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
    padding: 16,
  },
  heading: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#222',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginTop: 12,
    marginBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  optionCheck: {
    width: 22,
    fontSize: 15,
    color: '#1a5fb4',
    fontWeight: 'bold',
  },
  optionText: {
    fontSize: 15,
    color: '#222',
  },
  sizeStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingVertical: 8,
  },
  sizeBtn: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1a5fb4',
    width: 28,
    textAlign: 'center',
  },
  sizeBtnDisabled: {
    color: '#ccc',
  },
  sizePreview: {
    color: '#222',
    minWidth: 60,
    textAlign: 'center',
  },
  doneButton: {
    marginTop: 16,
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  doneText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
