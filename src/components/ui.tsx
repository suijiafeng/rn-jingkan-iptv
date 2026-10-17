import React from "react";
import { Pressable, Text, View, StyleSheet, ViewStyle } from "react-native";
import { colors, styles } from "../theme";
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  danger = false,
  style,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  danger?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: secondary ? colors.raised : colors.accent,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[
          s.label,
          { color: danger ? colors.bad : secondary ? colors.text : colors.ink },
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
  label: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
    textAlign: "center",
  },
});
