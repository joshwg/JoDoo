import { Ionicons } from '@expo/vector-icons';
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
import { clearServerConfig, getServerConfig, setServerConfig } from '../serverConfig';
import { refreshSyncConnections } from '../syncManager';
import { testServerConnection } from '../syncClient';
import { useTextSettings } from '../textSettings';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function ServerSettingsModal({ visible, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState('');
  const [serverKey, setServerKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const { scale } = useTextSettings();

  useEffect(() => {
    if (!visible) return;
    getServerConfig().then((config) => {
      setBaseUrl(config?.baseUrl ?? '');
      setServerKey(config?.serverKey ?? '');
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
