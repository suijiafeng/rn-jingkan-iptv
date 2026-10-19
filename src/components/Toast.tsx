import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, type } from "../theme";

/** How long one toast stays on screen. */
export const TOAST_MS = 3000;

interface ToastState {
  id: number;
  text: string;
}

let current: ToastState | null = null;
let lastId = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => current;

/**
 * The app's one notice: a short line at the top of the screen for about
 * 3 s. A newer toast replaces the one showing; nothing queues up.
 */
export function showToast(text: string) {
  if (timer !== null) clearTimeout(timer);
  current = { id: ++lastId, text };
  timer = setTimeout(hideToast, TOAST_MS);
  emit();
}

export function hideToast() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (current === null) return;
  current = null;
  emit();
}

/** The line on screen now, or null. */
export const currentToast = () => current?.text ?? null;

/**
 * Renders the toast above everything in the app's root view (not over
 * system dialogs or modals). It never takes touches, and screen readers
 * hear each new toast once.
 */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const insets = useSafeAreaInsets();
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!toast) return;
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
    AccessibilityInfo.announceForAccessibility(toast.text);
  }, [toast, opacity]);
  if (!toast) return null;
  return (
    <View
      testID="global-toast-host"
      pointerEvents="none"
      style={[
        toastStyles.host,
        { top: insets.top + 12, left: insets.left, right: insets.right },
      ]}
    >
      <Animated.View
        testID="global-toast"
        importantForAccessibility="no-hide-descendants"
        style={[toastStyles.toast, { opacity }]}
      >
        <Text style={toastStyles.text} numberOfLines={2}>
          {toast.text}
        </Text>
      </Animated.View>
    </View>
  );
}

const toastStyles = StyleSheet.create({
  // Kept clear of the 40dp corner buttons (back, picture-in-picture) that
  // sit under the status bar; longer text wraps to a second line instead.
  host: { position: "absolute", alignItems: "center", paddingHorizontal: 56 },
  toast: {
    minHeight: 36,
    maxWidth: 360,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    justifyContent: "center",
    backgroundColor: colors.raised,
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { ...type.chip, fontWeight: "400", color: colors.text },
});
