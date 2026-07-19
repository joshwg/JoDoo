import React, { forwardRef, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { TodoList } from '../types';

interface Props {
  list: TodoList;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  dragHitSlop: number;
  /** True while this specific tab is the one being dragged to reorder. */
  dragging: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDragStart: (list: TodoList) => void;
  onDragMove: (list: TodoList, pageX: number, pageY: number) => void;
  onDragEnd: (list: TodoList, pageX: number, pageY: number) => void;
}

/**
 * A single tab in the list strip. Tap to select, long-press to rename; the
 * small handle (⋮) initiates a horizontal drag to reorder the tabs.
 */
const ListTab = forwardRef<View, Props>(function ListTab(
  { list, style, textStyle, dragHitSlop, dragging, onSelect, onRename, onDragStart, onDragMove, onDragEnd },
  ref
) {
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Refs so the PanResponder (created once) always sees the latest props.
  const listRef = useRef(list);
  listRef.current = list;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Never let an ancestor (e.g. the tab strip's own horizontal scroll)
      // steal the responder once a reorder drag has begun.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        pan.setValue({ x: 0, y: 0 });
        onDragStartRef.current(listRef.current);
      },
      onPanResponderMove: (evt, gestureState) => {
        pan.setValue({ x: gestureState.dx, y: 0 });
        onDragMoveRef.current(listRef.current, evt.nativeEvent.pageX, evt.nativeEvent.pageY);
      },
      onPanResponderRelease: (evt) => {
        onDragEndRef.current(listRef.current, evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: (evt) => {
        onDragEndRef.current(listRef.current, evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
      },
    })
  ).current;

  return (
    <Animated.View
      ref={ref}
      style={[style, styles.container, dragging && styles.dragging, { transform: pan.getTranslateTransform() }]}
    >
      <View {...panResponder.panHandlers} style={styles.handle} hitSlop={12} accessibilityLabel="Drag to reorder list">
        <Text style={styles.handleIcon}>⋮</Text>
      </View>
      <Pressable onPress={onSelect} onLongPress={onRename} hitSlop={dragHitSlop} style={styles.pressable}>
        <Text style={textStyle} numberOfLines={1}>
          {list.shareKey ? '🔗 ' : ''}
          {list.name}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

export default ListTab;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dragging: {
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    opacity: 0.95,
    zIndex: 10,
  },
  handle: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  handleIcon: {
    fontSize: 22,
    lineHeight: 22,
    color: 'rgba(0,0,0,0.35)',
  },
  pressable: {
    flexShrink: 1,
  },
});
