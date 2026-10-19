import React, { memo, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Channel } from "../domain/types";
import { channelTitle, displayGroups } from "../domain/channelLabels";
import { isQualityTag } from "../domain/channelSources";
import { colors, sizes, styles, type } from "../theme";
import { ChannelLogo } from "./ChannelLogo";

/** Space between rows; lists add it as a separator or a content gap. */
export const CHANNEL_ROW_GAP = 4;

/**
 * Every row has the same height, so lists can place rows by arithmetic
 * (getItemLayout) instead of rendering and measuring them first. Without
 * that, a fast fling outruns the measurements and shows blank space.
 * Content: 8dp padding top and bottom, a title line (tags sit beside it),
 * a 2dp gap and one caption line; text lines grow with the font scale.
 */
export function channelRowHeight(fontScale: number): number {
  const lines =
    (type.rowTitle.lineHeight + type.caption.lineHeight) * fontScale;
  return Math.max(sizes.row, Math.ceil(16 + 2 + lines));
}

/** Offset of row `index` when rows are `rowHeight` apart by CHANNEL_ROW_GAP. */
export function channelRowLayout(
  rowHeight: number,
  index: number,
  leading = 0,
): { length: number; offset: number; index: number } {
  return {
    length: rowHeight,
    offset: leading + index * (rowHeight + CHANNEL_ROW_GAP),
    index,
  };
}
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
  hiddenGroup = null,
}: {
  channel: Channel;
  onPlay: (channel: Channel) => void;
  onFavorite: (channel: Channel) => void;
  current?: boolean;
  onRemoveRecent?: (channel: Channel) => void;
  recentBusy?: boolean;
  artworkEnabled?: boolean;
  /** The group the list is filtered to; left out of the caption. */
  hiddenGroup?: string | null;
}) {
  const { title, tags } = useMemo(
    () => channelTitle(channel.name),
    [channel.name],
  );
  const unreachable = channel.active && channel.checkStatus === "unreachable";
  const spokenLabels = [...tags, ...(unreachable ? ["暂时无法连接"] : [])];
  const { fontScale } = useWindowDimensions();
  const rowHeight = channelRowHeight(fontScale);
  const editingRecent = !!onRemoveRecent;
  const playbackDisabled = !channel.active || editingRecent;
  const caption = channel.active
    ? displayGroups(channel.groupName, hiddenGroup)
    : "节目单里已没有这个频道";
  return (
    <View style={[rowStyles.row, { height: rowHeight }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          editingRecent
            ? `${title}，观看记录`
            : `${title}${spokenLabels.length ? `，${spokenLabels.join("，")}` : ""}，${channel.active ? "播放" : "节目单里已没有这个频道"}`
        }
        accessibilityState={{ disabled: playbackDisabled, selected: current }}
        onPress={() => onPlay(channel)}
        disabled={playbackDisabled}
        style={({ pressed }) => [
          rowStyles.main,
          unreachable && rowStyles.unreachable,
          pressed && { opacity: 0.65 },
        ]}
      >
        <ChannelLogo
          uri={channel.logoUrl}
          title={title}
          enabled={artworkEnabled}
          size={sizes.logo}
        />
        <View style={rowStyles.text}>
          {/* One line: tags sit beside the title so every row has the
              same height (see channelRowHeight). */}
          <View style={rowStyles.titleLine}>
            <Text
              numberOfLines={1}
              style={[rowStyles.title, current && rowStyles.currentTitle]}
            >
              {title}
            </Text>
            {spokenLabels.map((label) => (
              <Text
                key={label}
                numberOfLines={1}
                // Quality is information, markers like 地区限制 are caveats.
                style={[rowStyles.tag, isQualityTag(label) && rowStyles.quiet]}
              >
                {label}
              </Text>
            ))}
          </View>
          {/* No source name: the row stands for a logical channel, and the
              source that actually plays is chosen at playback time. */}
          {!!caption && (
            <Text numberOfLines={1} style={styles.caption}>
              {caption}
            </Text>
          )}
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
            rowStyles.removeRecent,
            { opacity: recentBusy ? 0.4 : pressed ? 0.65 : 1 },
          ]}
        >
          <Text style={rowStyles.removeRecentText}>删除</Text>
        </Pressable>
      )}
      {!editingRecent && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${channel.favorite ? "取消收藏" : "收藏"}${title}`}
          accessibilityState={{ selected: channel.favorite }}
          onPress={() => onFavorite(channel)}
          style={rowStyles.star}
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
const rowStyles = StyleSheet.create({
  // No own background: rows sit directly on the page and the player sheet.
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 4,
    overflow: "hidden",
  },
  text: { flex: 1, gap: 2 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { ...type.rowTitle, color: colors.text, flexShrink: 1 },
  currentTitle: { color: colors.accent, fontWeight: "600" },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  tag: {
    ...type.muted,
    color: colors.warn,
    backgroundColor: colors.raised,
    borderRadius: 6,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  quiet: { color: colors.muted },
  unreachable: { opacity: 0.5 },
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
