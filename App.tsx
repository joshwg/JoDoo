import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as db from './src/db';
import ShoppingSection from './src/components/ShoppingSection';
import TodoSection from './src/components/TodoSection';

type Section = 'todo' | 'shopping';

export default function App() {
  // Open/create the database once, before first render of either section.
  useMemo(() => db.initDb(), []);
  const [section, setSection] = useState<Section>('todo');

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.content}>
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
