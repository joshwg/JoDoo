import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { getServerConfig } from '../serverConfig';
import { makeJoinUrl } from '../shareLinks';

interface Props {
  visible: boolean;
  shareKey: string | null;
  onClose: () => void;
}

/**
 * Shows everything the owner can hand to the other person: a QR code of the
 * join link (scannable from the other device's Jodoo app or camera), the
 * link itself via the OS share sheet, and the bare key for manual entry.
 * The link carries the server address and the list key - never the server
 * access key, which the recipient must get out-of-band.
 */
export default function ShareKeyModal({ visible, shareKey, onClose }: Props) {
  const [copied, setCopied] = useState<'key' | 'link' | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setCopied(null);
    setLink(null);
    if (shareKey) {
      getServerConfig().then((config) => {
        if (config) setLink(makeJoinUrl(config.baseUrl, shareKey));
      });
    }
  }, [visible, shareKey]);

  const copyKey = async () => {
    if (!shareKey) return;
    await Clipboard.setStringAsync(shareKey);
    setCopied('key');
  };

  const copyLink = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied('link');
  };

  const shareLink = async () => {
    if (!link) return;
    await Share.share({ message: `Join my Jodoo list: ${link}` });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>List Shared</Text>
          <Text style={styles.body}>
            Have the other person scan this code from "Scan QR Code" in their app, or send them
            the link. They can also enter the key by hand under "Join Shared List".
          </Text>
          {link != null && (
            <View style={styles.qrBox}>
              <QRCode value={link} size={180} backgroundColor="#fff" color="#000" />
            </View>
          )}
          <Text style={styles.key} selectable>
            {shareKey}
          </Text>
          {link != null && (
            <Pressable onPress={shareLink} style={styles.shareButton}>
              <Text style={styles.shareButtonText}>Share Link…</Text>
            </Pressable>
          )}
          <View style={styles.copyRow}>
            {link != null && (
              <Pressable onPress={copyLink} style={styles.copyButton}>
                <Text style={styles.copyText}>{copied === 'link' ? 'Copied!' : 'Copy Link'}</Text>
              </Pressable>
            )}
            <Pressable onPress={copyKey} style={styles.copyButton}>
              <Text style={styles.copyText}>{copied === 'key' ? 'Copied!' : 'Copy Key'}</Text>
            </Pressable>
          </View>
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
  qrBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  key: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a5fb4',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 12,
    textAlign: 'center',
  },
  shareButton: {
    backgroundColor: '#1a5fb4',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  shareButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  copyRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  copyButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  copyText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 14,
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  closeText: {
    color: '#1a5fb4',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
