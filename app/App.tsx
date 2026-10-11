import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  GestureResponderEvent,
  Linking,
  PanResponder,
  PanResponderGestureState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as db from './src/db';
import { joinShareByKey } from './src/joinShare';
import { getServerConfig, normalizeBaseUrl } from './src/serverConfig';
import { parseJoinUrl } from './src/shareLinks';
import { startSyncManager } from './src/syncManager';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, getFontSize, setFontSize } from './src/textSettings';
import ShoppingSection from './src/components/ShoppingSection';
import TodoSection from './src/components/TodoSection';

type Section = 'todo' | 'shopping';

const SWIPE_THRESHOLD = 50;
// Two-finger distance must change by this much (px) before the gesture is
// treated as a pinch rather than a section swipe. A swipe keeps the fingers
// roughly parallel, so their distance wobbles far less than this.
const PINCH_CLAIM_DISTANCE = 30;

function touchDistance(touches: { pageX: number; pageY: number }[]): number {
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

export default function App() {
  // Open/create the database once, before first render of either section.
  useMemo(() => db.initDb(), []);
  // Connect every shared list to the sync server once the UI is up; incoming
  // snapshots then reconcile local and remote state (including edits made
  // while the app was closed).
  useEffect(() => startSyncManager(), []);
  const [section, setSection] = useState<Section>('todo');

  // Share links: opening jodoo://join?key=... or https://<server>/join/<key>
  // (from a tapped link or a QR code scanned outside the app) lands here.
  // The link never carries the server access key, so joining only works once
  // the recipient has configured the server; otherwise we explain what's
  // missing instead of failing cryptically.
  useEffect(() => {
    const joinFromLink = async (key: string) => {
      try {
        const result = await joinShareByKey(key);
        // Show the section the list actually landed in; the section itself
        // refreshes via the join's remote-update event.
        setSection(result.kind);
      } catch (err) {
        Alert.alert('Could not join list', err instanceof Error ? err.message : String(err));
      }
    };

    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const parsed = parseJoinUrl(url);
      if (!parsed) return;
      const config = await getServerConfig();
      if (!config) {
        Alert.alert(
          'Connect to the server first',
          'This link is an invitation to a shared Jodoo list, but no sync server is set up yet. ' +
            `Open ⚙ → Server Settings and enter the server URL${
              parsed.server ? ` (${parsed.server})` : ''
            } and the server key from the person who shared the list, then open the link again.`
        );
        return;
      }
      const mismatch =
        parsed.server != null &&
        normalizeBaseUrl(parsed.server).toLowerCase() !==
          normalizeBaseUrl(config.baseUrl).toLowerCase();
      Alert.alert(
        'Join shared list?',
        'Add this shared list to your Jodoo?' +
          (mismatch
            ? `\n\nNote: the link points at ${parsed.server}, but this app is connected to ${config.baseUrl}. The key may not exist there.`
            : ''),
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Join', onPress: () => void joinFromLink(parsed.key) },
        ]
      );
    };

    Linking.getInitialURL().then((url) => void handleUrl(url));
    const sub = Linking.addEventListener('url', (event) => void handleUrl(event.url));
    return () => sub.remove();
  }, []);

  // Two-finger gestures: a horizontal swipe toggles between the To Do and
  // Shopping sections; a pinch adjusts the item text size live (the same
  // setting as ⚙ → Text Settings, persisted). The first clear signal wins:
  // finger distance changing → pinch, parallel horizontal travel → swipe.
  // 'pending' = claimed but not yet committed to pinch or swipe.
  const gestureModeRef = useRef<'pending' | 'swipe' | 'pinch' | null>(null);
  // Finger distance when two touches were first seen; the pinch/swipe
  // discrimination measures spread against it.
  const twoFingerBaseDistRef = useRef<number | null>(null);
  const pinchStartDistRef = useRef(1);
  const pinchStartSizeRef = useRef(getFontSize());
  const lastAppliedSizeRef = useRef<number | null>(null);

  // Two-finger gestures must be claimed in the CAPTURE phase: by the bubble
  // phase a list's scroll has usually taken the touch (a pinch nearly always
  // has a vertical component), so the pinch would never be consulted. Any
  // clear two-finger movement is claimed here; which gesture it is gets
  // decided inside the responder once the motion shows its shape.
  const claimTwoFinger = (
    evt: GestureResponderEvent,
    gestureState: PanResponderGestureState
  ): boolean => {
    const touches = evt.nativeEvent.touches;
    if (touches.length !== 2) {
      twoFingerBaseDistRef.current = null;
      return false;
    }
    const dist = touchDistance(touches);
    if (twoFingerBaseDistRef.current == null) {
      twoFingerBaseDistRef.current = dist;
      return false;
    }
    const spread = Math.abs(dist - twoFingerBaseDistRef.current);
    const travel = Math.hypot(gestureState.dx, gestureState.dy);
    if (spread <= 10 && travel <= 10) return false; // let two-finger taps through
    gestureModeRef.current = 'pending';
    pinchStartDistRef.current = dist;
    pinchStartSizeRef.current = getFontSize();
    lastAppliedSizeRef.current = null;
    return true;
  };

  const endTwoFinger = () => {
    gestureModeRef.current = null;
    twoFingerBaseDistRef.current = null;
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: claimTwoFinger,
      onMoveShouldSetPanResponder: claimTwoFinger,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length !== 2) return;
        const dist = touchDistance(touches);
        if (dist <= 0 || pinchStartDistRef.current <= 0) return;
        if (gestureModeRef.current === 'pending') {
          const spread = Math.abs(dist - pinchStartDistRef.current);
          if (spread > PINCH_CLAIM_DISTANCE) {
            gestureModeRef.current = 'pinch';
          } else if (
            Math.abs(gestureState.dx) > 20 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5
          ) {
            gestureModeRef.current = 'swipe';
          }
        }
        if (gestureModeRef.current !== 'pinch') return;
        const next = Math.round(
          Math.min(
            MAX_FONT_SIZE,
            Math.max(MIN_FONT_SIZE, pinchStartSizeRef.current * (dist / pinchStartDistRef.current))
          )
        );
        // setFontSize persists and re-renders the sections, so only call it
        // when the rounded size actually changes.
        if (next !== lastAppliedSizeRef.current) {
          lastAppliedSizeRef.current = next;
          setFontSize(next);
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        // A gesture that never grew into a pinch counts as a swipe if it
        // traveled far enough horizontally.
        if (gestureModeRef.current !== 'pinch' && Math.abs(gestureState.dx) >= SWIPE_THRESHOLD) {
          setSection((current) => (current === 'todo' ? 'shopping' : 'todo'));
        }
        endTwoFinger();
      },
      onPanResponderTerminate: endTwoFinger,
    }),
  ).current;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.content} {...panResponder.panHandlers}>
          {section === 'todo' ? <TodoSection /> : <ShoppingSection />}
        </View>
        <View style={styles.bottomBar}>
          <Pressable
            style={[styles.bottomTab, section === 'todo' && styles.bottomTabActive]}
            onPress={() => setSection('todo')}
          >
            <Text style={[styles.bottomText, section === 'todo' && styles.bottomTextActive]}>
              ✓ To Do
            </Text>
          </Pressable>
          <Pressable
            style={[styles.bottomTab, section === 'shopping' && styles.bottomTabActive]}
            onPress={() => setSection('shopping')}
          >
            <Text style={[styles.bottomText, section === 'shopping' && styles.bottomTextActive]}>
              🛒 Shopping
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fffdf5',
  },
  content: {
    flex: 1,
  },
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
    backgroundColor: '#f7f5ec',
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  bottomTabActive: {
    borderTopWidth: 2,
    borderTopColor: '#1a5fb4',
  },
  bottomText: {
    fontSize: 15,
    color: '#777',
  },
  bottomTextActive: {
    color: '#1a5fb4',
    fontWeight: 'bold',
  },
});
