import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { clearServerConfig, getServerConfig, setServerConfig } from '../serverConfig';
import { makeServerSetupPayload, parseServerSetupPayload } from '../serverSetup';
import { refreshSyncConnections } from '../syncManager';
import { fetchServerVersion, testServerConnection } from '../syncClient';
import { useTextSettings } from '../textSettings';
import QrScanModal from './QrScanModal';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function ServerSettingsModal({ visible, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState('');
  const [serverKey, setServerKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [setupQrVisible, setSetupQrVisible] = useState(false);
  const [scanVisible, setScanVisible] = useState(false);
  // null = no probe yet / no URL, 'checking' while a probe is in flight,
  // 'unreachable' when the probe failed, otherwise the server's version.
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const { scale } = useTextSettings();

  // The app's own version, from app.json via the build-time config.
  const appVersion = Constants.expoConfig?.version ?? '?';

  const probeServerVersion = (url: string) => {
    if (!url.trim()) {
      setServerVersion(null);
      return;
    }
    setServerVersion('checking');
    fetchServerVersion(url.trim()).then((v) => setServerVersion(v ?? 'unreachable'));
  };

  useEffect(() => {
    if (!visible) return;
    getServerConfig().then((config) => {
      setBaseUrl(config?.baseUrl ?? '');
      setServerKey(config?.serverKey ?? '');
      probeServerVersion(config?.baseUrl ?? '');
    });
    setKeyVisible(false);
  }, [visible]);

  const test = async () => {
    setBusy(true);
    try {
      await testServerConnection({ baseUrl: baseUrl.trim(), serverKey: serverKey.trim() });
      Alert.alert('Success', 'Connected to the server.');
    } catch (err) {
      Alert.alert('Connection failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      // Re-probe with whatever URL is in the field, so the version line
      // tracks what the user just tested rather than the saved config.
      probeServerVersion(baseUrl);
    }
  };

  const save = async () => {
    if (!baseUrl.trim() || !serverKey.trim()) {
      Alert.alert('Missing info', 'Enter both a server URL and a server key.');
      return;
    }
    setBusy(true);
    try {
      await setServerConfig({ baseUrl: baseUrl.trim(), serverKey: serverKey.trim() });
      await refreshSyncConnections();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const showSetupQr = () => {
    if (!baseUrl.trim() || !serverKey.trim()) {
      Alert.alert('Missing info', 'Enter both a server URL and a server key first.');
      return;
    }
    setSetupQrVisible(true);
  };

  const applyScannedSetup = (config: { baseUrl: string; serverKey: string }) => {
    setScanVisible(false);
    setBaseUrl(config.baseUrl);
    setServerKey(config.serverKey);
    Alert.alert(
      'Settings scanned',
      'Server URL and key filled in. Tap Test to check the connection, then Save.'
    );
  };

  const remove = () => {
    Alert.alert('Remove server', 'Stop syncing shared lists with this server?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await clearServerConfig();
          await refreshSyncConnections();
          setBaseUrl('');
          setServerKey('');
          onClose();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior="padding"
      >
        <View style={styles.sheet}>
          <Text style={styles.heading}>Server Settings</Text>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://jodoo.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.label}>Server Key</Text>
          <View style={styles.keyRow}>
            <TextInput
              style={[styles.input, styles.keyInput]}
              value={serverKey}
              onChangeText={setServerKey}
              placeholder="20+ character server key"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!keyVisible}
            />
            <Pressable
              onPress={() => setKeyVisible((v) => !v)}
              style={styles.keyToggle}
              hitSlop={8}
              accessibilityLabel={keyVisible ? 'Hide server key' : 'Show server key'}
            >
              <Ionicons
                name={keyVisible ? 'eye-off-outline' : 'eye-outline'}
                size={20 * scale}
                color="#1a5fb4"
              />
            </Pressable>
          </View>
          {/* Hand these settings to another device (or take them from one)
              via QR - in-app only, since the code contains the server key. */}
          <View style={styles.qrRow}>
            <Pressable onPress={showSetupQr} style={styles.qrButton} disabled={busy}>
              <Text style={styles.qrButtonText}>Show Setup QR</Text>
            </Pressable>
            <Pressable onPress={() => setScanVisible(true)} style={styles.qrButton} disabled={busy}>
              <Text style={styles.qrButtonText}>Scan Setup QR</Text>
            </Pressable>
          </View>
          {busy && <ActivityIndicator style={styles.spinner} />}
          <View style={styles.actions}>
            <Pressable onPress={remove} style={styles.button} disabled={busy}>
              <Text style={styles.destructiveText}>Remove</Text>
            </Pressable>
            <View style={styles.spacer} />
            <Pressable onPress={test} style={styles.button} disabled={busy}>
              <Text style={styles.secondaryText}>Test</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.button} disabled={busy}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} style={styles.button} disabled={busy}>
              <Text style={styles.primaryText}>Save</Text>
            </Pressable>
          </View>
          <Text style={styles.versionLine}>
            {`App: ${appVersion}  ·  Server: `}
            {serverVersion == null
              ? 'not configured'
              : serverVersion === 'checking'
                ? 'checking…'
                : serverVersion === 'unreachable'
                  ? 'unreachable'
                  : serverVersion}
          </Text>
        </View>

        {/* Setup QR display - nested so it stacks above this modal on iOS. */}
        <Modal
          visible={setupQrVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSetupQrVisible(false)}
        >
          <View style={styles.backdrop}>
            <View style={[styles.sheet, styles.qrSheet]}>
              <Text style={styles.heading}>Server Setup QR</Text>
              <Text style={styles.qrWarning}>
                ⚠️ This code contains the server address AND the server access key. Show it only
                to people you trust with access to your server.
              </Text>
              {setupQrVisible && (
                <View style={styles.qrBox}>
                  <QRCode
                    value={makeServerSetupPayload({
                      baseUrl: baseUrl.trim(),
                      serverKey: serverKey.trim(),
                    })}
                    size={200}
                    backgroundColor="#fff"
                    color="#000"
                  />
                </View>
              )}
              <Text style={styles.qrHint}>
                On the other device: ⚙ → Server Settings → Scan Setup QR.
              </Text>
              <Pressable onPress={() => setSetupQrVisible(false)} style={styles.button}>
                <Text style={styles.primaryText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <QrScanModal
          visible={scanVisible}
          onCancel={() => setScanVisible(false)}
          prompt="Point the camera at another device's Server Setup QR."
          badCodeHint="That QR code is not a Jodoo server setup code - keep looking."
          onCode={(data) => {
            const config = parseServerSetupPayload(data);
            if (!config) return false;
            applyScannedSetup(config);
            return true;
          }}
        />
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
    marginBottom: 10,
    color: '#222',
  },
  label: {
    fontSize: 13,
    color: '#666',
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#222',
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  keyInput: {
    flex: 1,
  },
  keyToggle: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  spinner: {
    marginTop: 12,
  },
  qrRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 12,
  },
  qrButton: {
    paddingVertical: 6,
  },
  qrButtonText: {
    color: '#1a5fb4',
    fontSize: 14,
    fontWeight: '600',
  },
  qrSheet: {
    alignItems: 'center',
  },
  qrWarning: {
    fontSize: 13,
    color: '#B00020',
    textAlign: 'center',
    marginTop: 8,
  },
  qrBox: {
    marginTop: 16,
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  qrHint: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  versionLine: {
    marginTop: 10,
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
  spacer: {
    flex: 1,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  destructiveText: {
    color: '#B00020',
    fontSize: 15,
  },
  secondaryText: {
    color: '#666',
    fontSize: 15,
  },
  primaryText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
