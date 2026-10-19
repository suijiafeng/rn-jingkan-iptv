import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  facetLabel,
  type ChannelFacetSelection,
  type FacetKind,
} from "../../domain/channelFacets";
import { colors, sizes, type } from "../../theme";

const MENU_KINDS = ["country", "language"] as const;
const LABELS = { country: "国家/地区", language: "语言" };

/** The country/language dimensions that currently narrow the list. */
export function activeMenuFacets(selection: ChannelFacetSelection) {
  return MENU_KINDS.filter((kind) => selection[kind] !== null);
}

/**
 * One icon at the end of the search row instead of a standing row of
 * "国家/地区 全部 ▾ 语言 全部 ▾": the menus unfold only when asked for.
 */
export function FacetToggle({
  open,
  active,
  onPress,
}: {
  open: boolean;
  /** A country or language is set: the icon is tinted. */
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="按国家/地区或语言筛选"
      accessibilityState={{ expanded: open, selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        chipStyles.toggle,
        (open || active) && chipStyles.toggleOn,
        pressed && { opacity: 0.7 },
      ]}
    >
      {/* Three shrinking bars: the usual "filter" glyph. */}
      <View style={chipStyles.glyph}>
        <View style={[chipStyles.bar, { width: 16 }]} />
        <View style={[chipStyles.bar, { width: 11 }]} />
        <View style={[chipStyles.bar, { width: 6 }]} />
      </View>
    </Pressable>
  );
}

/**
 * While the menus are folded, each set dimension shows as a small chip
 * ("中国 ×"), so a shortened list always says why and can be cleared.
 */
export function ActiveFacetChips({
  selection,
  onChange,
}: {
  selection: ChannelFacetSelection;
  onChange: (selection: ChannelFacetSelection, kind?: FacetKind) => void;
}) {
  const active = activeMenuFacets(selection);
  if (!active.length) return null;
  return (
    <View style={chipStyles.row}>
      {active.map((kind) => {
        const label = facetLabel(kind, selection[kind]);
        return (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityLabel={`清除${LABELS[kind]}筛选：${label}`}
            onPress={() => onChange({ ...selection, [kind]: null }, kind)}
            style={({ pressed }) => [
              chipStyles.chip,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text numberOfLines={1} style={chipStyles.chipText}>
              {label} ×
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  toggle: {
    width: sizes.field,
    height: sizes.field,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.raised,
  },
  toggleOn: { backgroundColor: colors.accentSoft },
  glyph: { gap: 3, alignItems: "center" },
  bar: { height: 2, borderRadius: 1, backgroundColor: colors.accent },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    minHeight: sizes.chip,
    maxWidth: 200,
    paddingHorizontal: 12,
    borderRadius: sizes.chip / 2,
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  chipText: { ...type.chip, color: colors.accent },
});
