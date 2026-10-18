import React, { memo, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Channel } from "../domain/types";
import { channelTitle, displayGroups } from "../domain/channelLabels";
import { colors, styles } from "../theme";
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
  flat = false,
}: {
  channel: Channel;
  onPlay: (channel: Channel) => void;
  onFavorite: (channel: Channel) => void;
  current?: boolean;
  onRemoveRecent?: (channel: Channel) => void;
  recentBusy?: boolean;
  artworkEnabled?: boolean;
  /** On a surface already (the player sheet): no own background. */
  flat?: boolean;
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
    <View
      style={[
        s.row,
        flat && s.flat,
        current && { borderColor: colors.accent, borderWidth: 1 },
      ]}
    >
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
          size={flat ? 44 : 36}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            numberOfLines={2}
            style={[
              styles.heading,
              flat && s.flatTitle,
              current && flat && s.flatCurrent,
            ]}
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
          <Text numberOfLines={2} style={[styles.muted, flat && s.flatMeta]}>
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
});
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
  flat: { backgroundColor: "transparent", minHeight: 62 },
  flatTitle: { fontSize: 15, lineHeight: 20, fontWeight: "500" },
  flatCurrent: { color: colors.accent, fontWeight: "600" },
  flatMeta: { fontSize: 11, lineHeight: 16 },
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
