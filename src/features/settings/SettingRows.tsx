import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, sizes, styles, type } from "../../theme";

/** A caption above a grouped card of rows. */
export function SettingSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={rowStyles.section}>
      <Text style={[styles.caption, rowStyles.sectionLabel]}>{label}</Text>
      <View style={rowStyles.card}>
        {rows.map((row, index) => (
          <React.Fragment key={index}>
            {index > 0 && <View style={rowStyles.divider} />}
            {row}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

/**
 * One row: title with an optional status pill, a caption underneath and a
 * trailing control (switch, text action or chevron). Pressable as a whole
 * when onPress is given.
 */
export function SettingRow({
  title,
  caption,
  status,
  trailing,
  onPress,
  accessibilityLabel,
  danger = false,
  dimmed = false,
}: {
  title: string;
  caption?: string;
  status?: { label: string; tone: "accent" | "muted" | "warn" };
  trailing?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** A destructive row: the title in the error colour. */
  danger?: boolean;
  /** Not currently applicable: shown faded, like a disabled switch. */
  dimmed?: boolean;
}) {
  const body = (
    <>
      <View style={rowStyles.text}>
        <View style={rowStyles.titleLine}>
          <Text style={[styles.body, danger && rowStyles.dangerTitle]}>
            {title}
          </Text>
          {status && (
            <Text style={[rowStyles.pill, rowStyles[`pill_${status.tone}`]]}>
              {status.label}
            </Text>
          )}
        </View>
        {caption && <Text style={styles.caption}>{caption}</Text>}
      </View>
      {trailing}
    </>
  );
  if (!onPress)
    return (
      <View style={[rowStyles.row, dimmed && rowStyles.dimmed]}>{body}</View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [rowStyles.row, pressed && rowStyles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/** A text-only action at the end of a row (撤销, 重试保存). */
export function RowAction({
  label,
  onPress,
  danger = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [rowStyles.action, pressed && rowStyles.pressed]}
    >
      <Text style={[rowStyles.actionText, danger && rowStyles.dangerTitle]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Chevron() {
  return (
    <Text accessible={false} style={rowStyles.chevron}>
      ›
    </Text>
  );
}

const rowStyles = StyleSheet.create({
  section: { gap: 6 },
  sectionLabel: { paddingHorizontal: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: "hidden",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginLeft: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 12,
  },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.4 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  dangerTitle: { color: colors.bad },
  pill: {
    ...type.caption,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1,
    overflow: "hidden",
  },
  pill_accent: { color: colors.ink, backgroundColor: colors.accent },
  pill_muted: { color: colors.muted, backgroundColor: colors.raised },
  pill_warn: { color: colors.ink, backgroundColor: colors.warn },
  action: {
    minHeight: sizes.chip,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    justifyContent: "center",
  },
  actionText: { ...type.chip, color: colors.accent },
  chevron: { ...type.heading, color: colors.muted, paddingHorizontal: 4 },
});
