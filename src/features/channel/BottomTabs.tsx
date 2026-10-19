import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ClockIcon,
  SlidersIcon,
  StarIcon,
  TvIcon,
} from "../../components/navIcons";
import { colors, sizes, type } from "../../theme";
import type { Tab } from "./ChannelListParts";

const TABS = [
  ["all", "频道", TvIcon],
  ["favorites", "收藏", StarIcon],
  ["recent", "最近", ClockIcon],
  ["settings", "设置", SlidersIcon],
] as const;

/**
 * The app's four destinations: an icon over a short label, with the
 * selected one in the accent colour on a small pill behind its icon.
 */
export function BottomTabs({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={tabStyles.bar}>
      {TABS.map(([key, label, Icon]) => {
        const selected = tab === key;
        const tint = selected ? colors.accent : colors.muted;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(key);
            }}
            style={({ pressed }) => [
              tabStyles.tab,
              pressed && tabStyles.pressed,
            ]}
          >
            {/* Keyed so the pill is created with its fill: Android lost
                the rounded corners when the colour was added later. */}
            <View
              key={selected ? "selected" : "idle"}
              style={[tabStyles.iconPill, selected && tabStyles.iconPillOn]}
            >
              <Icon color={tint} filled={selected} size={20} />
            </View>
            <Text
              style={[
                tabStyles.label,
                { color: tint },
                selected && tabStyles.labelOn,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  tab: {
    flex: 1,
    minHeight: sizes.touch,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  pressed: { opacity: 0.7 },
  iconPill: {
    width: 56,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  iconPillOn: { borderRadius: 14, backgroundColor: colors.raised },
  label: type.caption,
  labelOn: { fontWeight: "600" },
});
