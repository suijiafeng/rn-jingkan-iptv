import React from "react";
import {
  Pressable,
  Text,
  View,
  StyleSheet,
  ViewStyle,
  type AccessibilityRole,
} from "react-native";
import { colors, styles } from "../theme";
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  danger = false,
  selected,
  accessibilityRole = "button",
  accessibilityLabel,
  style,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  danger?: boolean;
  selected?: boolean;
  accessibilityRole?: AccessibilityRole;
  /** Spoken label when the visible text is abbreviated; defaults to label. */
  accessibilityLabel?: string;
  style?: ViewStyle;
  /** Chip-sized (34dp, 13px) for dense rows such as the player's filters. */
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{
        disabled,
        ...(selected !== undefined ? { selected } : {}),
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        compact && s.buttonCompact,
        {
          backgroundColor: secondary
            ? compact
              ? colors.surface
              : colors.raised
            : compact
              ? colors.text
              : colors.accent,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[
          s.label,
          compact && s.labelCompact,
          {
            color: danger
              ? colors.bad
              : secondary
                ? compact
                  ? colors.muted
                  : colors.text
                : compact
                  ? colors.bg
                  : colors.ink,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Heading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={{ gap: 4, marginBottom: 4 }}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {subtitle && <Text style={styles.muted}>{subtitle}</Text>}
    </View>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}
export function Notice({
  title,
  body,
  error = false,
}: {
  title: string;
  body?: string;
  error?: boolean;
}) {
  return (
    <Card>
      <Text
        accessibilityRole={error ? "alert" : "text"}
        style={[styles.heading, { color: error ? colors.bad : colors.accent }]}
      >
        {title}
      </Text>
      {body && (
        <Text style={[styles.body, { color: colors.muted }]}>{body}</Text>
      )}
    </Card>
  );
}
const s = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonCompact: {
    minHeight: 34,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  label: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
    textAlign: "center",
  },
  labelCompact: { fontSize: 13, lineHeight: 20, fontWeight: "500" },
});
