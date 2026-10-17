import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Channel } from "../domain/types";
import { colors, styles } from "../theme";
export function ChannelRow({
  channel,
  onPlay,
  onFavorite,
  current = false,
}: {
  channel: Channel;
  onPlay: () => void;
  onFavorite: () => void;
  current?: boolean;
}) {
  return (
    <View
      style={[s.row, current && { borderColor: colors.accent, borderWidth: 1 }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${channel.name}，${channel.active ? "播放" : "来源已不再提供"}`}
        onPress={onPlay}
        disabled={!channel.active}
        style={s.main}
      >
        <View style={s.badge}>
          <Text style={[styles.heading, { color: colors.accent }]}>
            {channel.name.slice(0, 1)}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={2} style={styles.heading}>
            {channel.name}
          </Text>
          <Text numberOfLines={2} style={styles.muted}>
            {channel.active
              ? `${channel.groupName} · ${channel.sourceName}`
              : "来源已不再提供"}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${channel.favorite ? "取消收藏" : "收藏"}${channel.name}`}
        accessibilityState={{ selected: channel.favorite }}
        onPress={onFavorite}
        style={s.star}
      >
        <Text
          style={{
            fontSize: 24,
            color: channel.favorite ? colors.accent : colors.muted,
          }}
        >
          {channel.favorite ? "★" : "☆"}
        </Text>
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 80,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingLeft: 16,
    paddingRight: 4,
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    minHeight: 80,
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  star: {
    minWidth: 52,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
});
