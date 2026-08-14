import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  visible: boolean;
  onCancel: () => void;
  /** What the user should point the camera at. */
  prompt: string;
  /** Shown after a QR decodes to something this scanner doesn't accept. */
  badCodeHint: string;
  /** Tries one scanned QR payload. Return true to accept it (the scanner
   *  stops firing), false to keep scanning. */
  onCode: (data: string) => boolean;
}

/**
 * Full-screen QR scanner shared by "join a list" and "scan server setup".
 * Unrecognized codes show a hint and scanning continues.
 */
export default function QrScanModal({ visible, onCancel, prompt, badCodeHint, onCode }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [badCode, setBadCode] = useState(false);
  // Guards against the camera firing multiple times for one code.
  const handledRef = useRef(false);

  useEffect(() => {
    if (visible) {
      handledRef.current = false;
      setBadCode(false);
    }
  }, [visible]);

  // Ask for camera access automatically the first time the scanner is
  // opened ('undetermined' = the OS has never shown the prompt). After a
  // denial we never re-prompt on open; the button below is the way back in.
  useEffect(() => {
    if (visible && permission?.status === 'undetermined') {
      requestPermission();
    }
  }, [visible, permission?.status, requestPermission]);

  const handleBarcode = ({ data }: { data: string }) => {
    if (handledRef.current) return;
    if (onCode(data)) {
      handledRef.current = true;
    } else {
      setBadCode(true);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcode}
          />
        ) : (
          <View style={styles.permissionBox}>
            <Text style={styles.permissionText}>
              Jodoo needs camera access to scan a QR code.
            </Text>
            {permission != null && !permission.granted && (
              <Pressable onPress={requestPermission} style={styles.permissionButton}>
                <Text style={styles.permissionButtonText}>
                  {permission.canAskAgain ? 'Allow Camera' : 'Enable in system settings'}
                </Text>
              </Pressable>
            )}
          </View>
        )}
        <View style={styles.overlay}>
          <Text style={styles.hint}>{badCode ? badCodeHint : prompt}</Text>
          <Pressable onPress={onCancel} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  permissionText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: 20,
    backgroundColor: '#1a5fb4',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  permissionButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    paddingBottom: 48,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hint: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
  },
  cancelButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fff',
  },
  cancelText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
