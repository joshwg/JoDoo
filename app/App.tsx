import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as db from './src/db';
import { startSyncManager } from './src/syncManager';
import ShoppingSection from './src/components/ShoppingSection';
import TodoSection from './src/components/TodoSection';

type Section = 'todo' | 'shopping';

const SWIPE_THRESHOLD = 50;

export default function App() {
  // Open/create the database once, before first render of either section.
  useMemo(() => db.initDb(), []);
  // Connect every shared list to the sync server once the UI is up; incoming
  // snapshots then reconcile local and remote state (including edits made
  // while the app was closed).
  useEffect(() => startSyncManager(), []);
  const [section, setSection] = useState<Section>('todo');

  // A two-finger horizontal swipe toggles between the To Do and Shopping sections.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) =>
        evt.nativeEvent.touches.length === 2 &&
        Math.abs(gestureState.dx) > 20 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5,
      onPanResponderRelease: (_evt, gestureState) => {
        if (Math.abs(gestureState.dx) >= SWIPE_THRESHOLD) {
          setSection((current) => (current === 'todo' ? 'shopping' : 'todo'));
        }
      },
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
