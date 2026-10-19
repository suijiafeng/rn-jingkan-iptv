import React, { useState, useSyncExternalStore } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/ui";
import { colors, sizes, styles, type } from "../../theme";

export interface ConsentAction<Value extends string = string> {
  label: string;
  value: Value;
  secondary?: boolean;
}

export interface ConsentRequest<Value extends string = string> {
  title: string;
  /** Two to four short lines that cover what matters. */
  points: readonly string[];
  /** The complete informed-consent text; folded, never shortened. */
  details: string;
  /** Left to right; the last one is the primary action. */
  actions: readonly ConsentAction<Value>[];
  /** Answer for back, the system dismiss and anything else that closes it. */
  dismissValue: Value;
}

/**
 * Informed consent in two layers: a few short points and the full text one
 * tap away. Nothing is left out; it is only folded. The full text starts
 * folded on every showing.
 */
export function ConsentDialog({
  visible,
  request,
  onAnswer,
}: {
  visible: boolean;
  request: ConsentRequest;
  onAnswer: (value: string) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const answer = (value: string) => {
    setDetailsOpen(false);
    onAnswer(value);
  };
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={() => answer(request.dismissValue)}
    >
      <View style={dialogStyles.scrim}>
        <View
          accessibilityViewIsModal
          accessibilityLabel={request.title}
          style={dialogStyles.panel}
        >
          <Text accessibilityRole="header" style={dialogStyles.title}>
            {request.title}
          </Text>
          <ScrollView contentContainerStyle={dialogStyles.body}>
            {request.points.map((point) => (
              <View key={point} style={dialogStyles.point}>
                <View style={dialogStyles.bullet} />
                <Text style={[styles.body, dialogStyles.pointText]}>
                  {point}
                </Text>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: detailsOpen }}
              onPress={() => setDetailsOpen((open) => !open)}
              style={dialogStyles.detailsToggle}
            >
              <Text style={dialogStyles.detailsToggleText}>
                {detailsOpen ? "收起说明" : "完整说明 ›"}
              </Text>
            </Pressable>
            {detailsOpen && (
              <Text style={[styles.muted, dialogStyles.details]}>
                {request.details}
              </Text>
            )}
          </ScrollView>
          <View style={dialogStyles.actions}>
            {request.actions.map((action, index) => (
              <Button
                key={action.value}
                compact
                secondary={
                  action.secondary ?? index < request.actions.length - 1
                }
                label={action.label}
                onPress={() => answer(action.value)}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface Pending {
  request: ConsentRequest;
  resolve: (value: string) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => pending;

/**
 * Asks one layered consent question through the app's ConsentHost. A newer
 * question replaces an unanswered one, which counts as dismissed.
 */
export function askConsent<Value extends string>(
  request: ConsentRequest<Value>,
): Promise<Value> {
  return new Promise<Value>((resolve) => {
    const previous = pending;
    pending = {
      request,
      resolve: (value) => resolve(value as Value),
    };
    previous?.resolve(previous.request.dismissValue);
    emit();
  });
}

/** Answers the question showing now; a no-op when none is. */
export function answerConsent(value: string) {
  const answered = pending;
  if (!answered) return;
  pending = null;
  emit();
  answered.resolve(value);
}

/** The question showing now, or null. */
export const currentConsent = () => pending?.request ?? null;

/** Shows the question from askConsent; mounted once at the app's root. */
export function ConsentHost() {
  const shown = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!shown) return null;
  return (
    <ConsentDialog visible request={shown.request} onAnswer={answerConsent} />
  );
}

const dialogStyles = StyleSheet.create({
  scrim: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  panel: {
    maxHeight: "86%",
    borderRadius: 24,
    padding: 24,
    gap: 16,
    backgroundColor: colors.raised,
  },
  title: { ...type.title, fontSize: 20, color: colors.text },
  body: { gap: 10 },
  point: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: {
    width: 6,
    height: 6,
    marginTop: 7,
    borderRadius: 3,
    backgroundColor: colors.muted,
  },
  pointText: { flex: 1 },
  detailsToggle: { minHeight: sizes.touch, justifyContent: "center" },
  detailsToggleText: { ...type.body, color: colors.accent },
  details: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 8,
  },
});
