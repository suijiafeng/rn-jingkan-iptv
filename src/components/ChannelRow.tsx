import React, { memo, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Channel } from "../domain/types";
import { channelTitle, displayGroups } from "../domain/channelLabels";
import { colors, sizes, styles, type } from "../theme";
import { ChannelLogo } from "./ChannelLogo";
/**
 * Memoized: with 10k+ rows the list re-renders cells on every parent update,
 * so callers pass stable handlers that receive the channel.
 */
export const ChannelRow = memo(function ChannelRow({
  channel,
  onPlay,
  onFavorite,
  current = false,
  onRemoveRecent,
  recentBusy = false,
  artworkEnabled = false,
}: {
  channel: Channel;
  onPlay: (channel: Channel) => void;
  onFavorite: (channel: Channel) => void;
  current?: boolean;
  onRemoveRecent?: (channel: Channel) => void;
  recentBusy?: boolean;
  artworkEnabled?: boolean;
}) {
  const { title, tags } = useMemo(
    () => channelTitle(channel.name),
    [channel.name],
  );
  const unreachable = channel.active && channel.checkStatus === "unreachable";
  const labels = [...tags, ...(unreachable ? ["不可用"] : [])];
  const editingRecent = !!onRemoveRecent;
  const playbackDisabled = !channel.active || editingRecent;
  return (
    <View style={s.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          editingRecent
            ? `${title}，观看记录`
            : `${title}${labels.length ? `，${labels.join("，")}` : ""}，${channel.active ? "播放" : "来源已不再提供"}`
        }
        accessibilityState={{ disabled: playbackDisabled, selected: current }}
        onPress={() => onPlay(channel)}
        disabled={playbackDisabled}
        style={({ pressed }) => [s.main, pressed && { opacity: 0.65 }]}
      >
        <ChannelLogo
          uri={channel.logoUrl}
          title={title}
          enabled={artworkEnabled}
          size={sizes.logo}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            numberOfLines={2}
            style={[s.title, current && s.currentTitle]}
          >
            {title}
          </Text>
          {labels.length > 0 && (
            <View style={s.tags}>
              {labels.map((label) => (
                <Text
                  key={label}
                  style={[s.tag, label === "不可用" && s.badTag]}
                >
                  {label}
                </Text>
              ))}
            </View>
          )}
          {/* No source name: the row stands for a logical channel, and the
              source that actually plays is chosen at playback time. */}
          <Text numberOfLines={2} style={styles.caption}>
            {channel.active
              ? displayGroups(channel.groupName)
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
          onPress={() => onRemoveRecent(channel)}
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
          onPress={() => onFavorite(channel)}
          style={s.star}
        >
          <Text
            style={{
              fontSize: 20,
              color: channel.favorite ? colors.warn : colors.mutedFaint,
            }}
          >
            {channel.favorite ? "★" : "☆"}
          </Text>
        </Pressable>
      )}
    </View>
  );
});
const s = StyleSheet.create({
  // No own background: rows sit directly on the page and the player sheet.
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: sizes.row,
    paddingLeft: 12,
    paddingRight: 4,
  },
  title: { ...type.rowTitle, color: colors.text },
  currentTitle: { color: colors.accent, fontWeight: "600" },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    minHeight: sizes.row,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    ...type.muted,
    color: colors.warn,
    backgroundColor: colors.raised,
    borderRadius: 6,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  badTag: { color: colors.bad },
  star: {
    minWidth: sizes.touch,
    minHeight: sizes.touch,
    alignItems: "center",
    justifyContent: "center",
  },
  removeRecent: {
    minWidth: sizes.touch,
    minHeight: sizes.touch,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  removeRecentText: { ...type.body, color: colors.bad },
});
