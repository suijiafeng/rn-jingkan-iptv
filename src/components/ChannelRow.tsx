import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Channel } from "../domain/types";
import { channelTitle, displayGroups } from "../domain/channelLabels";
import { colors, styles } from "../theme";
import { ChannelLogo } from "./ChannelLogo";
export function ChannelRow({
  channel,
  onPlay,
  onFavorite,
  current = false,
  onRemoveRecent,
  recentBusy = false,
  artworkEnabled = false,
}: {
  channel: Channel;
  onPlay: () => void;
  onFavorite: () => void;
  current?: boolean;
  onRemoveRecent?: () => void;
  recentBusy?: boolean;
  artworkEnabled?: boolean;
}) {
  const { title, tags } = channelTitle(channel.name);
  const unreachable = channel.active && channel.checkStatus === "unreachable";
  const labels = [...tags, ...(unreachable ? ["上次检测不可达"] : [])];
  const editingRecent = !!onRemoveRecent;
  const playbackDisabled = !channel.active || editingRecent;
  return (
    <View
      style={[s.row, current && { borderColor: colors.accent, borderWidth: 1 }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          editingRecent
            ? `${title}，观看记录`
            : `${title}${labels.length ? `，${labels.join("，")}` : ""}，${channel.active ? "播放" : "来源已不再提供"}`
        }
        accessibilityState={{ disabled: playbackDisabled, selected: current }}
        onPress={onPlay}
        disabled={playbackDisabled}
        style={({ pressed }) => [s.main, pressed && { opacity: 0.65 }]}
      >
        <ChannelLogo
          uri={channel.logoUrl}
          title={title}
          enabled={artworkEnabled}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={2} style={styles.heading}>
            {title}
          </Text>
          {labels.length > 0 && (
            <View style={s.tags}>
              {labels.map((label) => (
                <Text
                  key={label}
                  style={[s.tag, label === "上次检测不可达" && s.badTag]}
                >
                  {label}
                </Text>
              ))}
            </View>
          )}
          <Text numberOfLines={2} style={styles.muted}>
            {channel.active
              ? `${displayGroups(channel.groupName)} · ${channel.sourceName}`
              : "来源已不再提供"}
          </Text>
        </View>
      </Pressable>
      {onRemoveRecent && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`删除${title}的观看记录`}
          accessibilityState={{ disabled: recentBusy }}
          disabled={recentBusy}
          onPress={onRemoveRecent}
          style={({ pressed }) => [
            s.removeRecent,
            { opacity: recentBusy ? 0.4 : pressed ? 0.65 : 1 },
          ]}
        >
          <Text style={s.removeRecentText}>删除</Text>
        </Pressable>
      )}
      {!editingRecent && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${channel.favorite ? "取消收藏" : "收藏"}${title}`}
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
      )}
    </View>
  );
}
const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 72,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingLeft: 12,
    paddingRight: 4,
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    minHeight: 72,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.warn,
    backgroundColor: colors.raised,
    borderRadius: 6,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  badTag: { color: colors.bad },
  star: {
    minWidth: 52,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  removeRecent: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  removeRecentText: { color: colors.bad, fontSize: 14, lineHeight: 21 },
});
