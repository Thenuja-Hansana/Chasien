import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type FlatListProps,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** How far the sheet has to be dragged down (points), or how fast (points/second), before letting go closes it. */
const CLOSE_DISTANCE = 110;
const CLOSE_VELOCITY = 1100;
/** Finger travel (points) before a drag on the list decides between moving the sheet and scrolling the list. */
const LIST_DRAG_SLOP = 4;
const OPEN_TIMING = { duration: 260, easing: Easing.out(Easing.cubic) };
const CLOSE_TIMING = { duration: 200, easing: Easing.out(Easing.quad) };

/** The list's scroll position, so a drag on the list only moves the sheet when the list is at its top. */
const SheetScrollContext = createContext<SharedValue<number> | null>(null);

/**
 * The tall, titled bottom sheet the feed's Comments and Likes lists use —
 * the shape in Instagram's own versions: rounded top, a grab handle, a
 * centered title, and the content scrolling beneath. Close by tapping
 * outside, the hardware back button, or dragging it down: from the handle
 * or title, or from the list when the list is scrolled to its top. 68% of
 * the screen, so the post stays visible above it.
 *
 * The drag is react-native-gesture-handler + Reanimated, so the sheet follows
 * the finger on the UI thread. (It used to be a PanResponder on the header
 * that only asked for the touch once the finger moved — by then another view
 * had already claimed it, so the header never got the drag and swiping down
 * did nothing; and a JS-thread drag lagged behind the finger.) An RN <Modal>
 * is its own window on Android, so it needs its own GestureHandlerRootView.
 *
 * Opening and closing are animated here, not by the Modal: the sheet slides
 * and the dim backdrop fades with it (also while dragging), and `onClose`
 * fires only once the sheet is off screen. The Modal's own "slide" moved its
 * whole window — backdrop included — so after a drag-close the dim layer
 * swept down the screen behind the sheet.
 *
 * Keep `visible` in the sheet's own component (see CommentsSheet's `open()`
 * handle), not in the screen behind it: toggling state on the feed screen
 * re-rendered the whole feed first, delaying every open and close by up to
 * ~0.9 s in a dev build.
 *
 * Lists inside must be BottomSheetFlatList, which reports the scroll
 * position the list drag needs.
 *
 * Keyboard: 'height' on Android, never undefined (see the decision log's
 * "Location sheet hid behind the keyboard") — the Comments composer lives
 * at the bottom of this sheet.
 */
export default function BottomSheet({
  visible,
  title,
  onClose,
  children,
  heightFraction = 0.68,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  heightFraction?: number;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = windowHeight * heightFraction;
  // Starts (and is left) below the screen, so the first frame after the Modal
  // mounts shows nothing until the open animation runs.
  const translateY = useSharedValue(windowHeight);
  const scrollOffset = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  // Each time the sheet opens: slide up from below, list at its top.
  useEffect(() => {
    if (!visible) return;
    scrollOffset.set(0);
    translateY.set(windowHeight);
    translateY.set(withTiming(0, OPEN_TIMING));
  }, [visible, translateY, scrollOffset, windowHeight]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));
  // Fully dim with the sheet up, clear once it's down by its own height.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.get(), [0, sheetHeight], [1, 0], Extrapolation.CLAMP),
  }));

  function animateClosed() {
    'worklet';
    translateY.set(
      withTiming(windowHeight, CLOSE_TIMING, (finished) => {
        if (finished) scheduleOnRN(onClose);
      }),
    );
  }

  // Backdrop tap and the hardware back button.
  function requestClose() {
    animateClosed();
  }

  function release(translationY: number, velocityY: number) {
    'worklet';
    if (translationY > CLOSE_DISTANCE || velocityY > CLOSE_VELOCITY) {
      animateClosed();
    } else {
      translateY.set(withSpring(0, { damping: 22, stiffness: 240 }));
    }
  }

  // The handle and title: any downward drag moves the sheet.
  const headerDrag = Gesture.Pan()
    .activeOffsetY(LIST_DRAG_SLOP)
    .failOffsetX([-24, 24])
    .onUpdate((event) => {
      translateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      release(event.translationY, event.velocityY);
    });

  // The content: only a downward drag while the list is at its top moves the
  // sheet. Anything else fails straight away, leaving the touch to the list's
  // own scrolling and to the buttons and inputs inside. Decided within a few
  // points — before Android's scroll view would start dragging on its own.
  const contentDrag = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event) => {
      touchStartY.set(event.allTouches[0]?.absoluteY ?? 0);
    })
    .onTouchesMove((event, manager) => {
      const dy = (event.allTouches[0]?.absoluteY ?? 0) - touchStartY.get();
      if (scrollOffset.get() > 0 || dy < -LIST_DRAG_SLOP) {
        manager.fail();
      } else if (dy > LIST_DRAG_SLOP) {
        manager.activate();
      }
    })
    .onUpdate((event) => {
      translateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      release(event.translationY, event.velocityY);
    });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={requestClose}>
      <GestureHandlerRootView style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[styles.backdrop, backdropStyle]}>
            <Pressable style={styles.flex} onPress={requestClose} accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View style={[styles.sheet, { height: `${Math.round(heightFraction * 100)}%`, paddingBottom: insets.bottom }, sheetStyle]}>
            <GestureDetector gesture={headerDrag}>
              <View style={styles.header}>
                <View style={styles.grabber} />
                <Text style={styles.title} accessibilityRole="header">
                  {title}
                </Text>
              </View>
            </GestureDetector>
            <GestureDetector gesture={contentDrag}>
              <View style={styles.flex}>
                <SheetScrollContext.Provider value={scrollOffset}>{children}</SheetScrollContext.Provider>
              </View>
            </GestureDetector>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** A FlatList for inside a BottomSheet: reports its scroll position so dragging down from its top closes the sheet. */
export function BottomSheetFlatList<ItemT>(props: FlatListProps<ItemT>) {
  const scrollOffset = useContext(SheetScrollContext);
  const { onScroll } = props;
  return (
    <FlatList
      {...props}
      scrollEventThrottle={16}
      onScroll={(event) => {
        scrollOffset?.set(event.nativeEvent.contentOffset.y);
        onScroll?.(event);
      }}
    />
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    backdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.bg,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      overflow: 'hidden',
    },
    header: {
      alignItems: 'center',
      paddingTop: Spacing[2],
      paddingBottom: Spacing[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    grabber: {
      width: 40,
      height: 4,
      borderRadius: Radius.pill,
      backgroundColor: colors.neutral[300],
      marginBottom: Spacing[3],
    },
    title: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 15,
      color: colors.text,
    },
  });
