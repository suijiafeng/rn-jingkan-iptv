import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChannelRow } from "../../components/ChannelRow";
import { ChannelFilterBar, type ListTab } from "../channel/ChannelListParts";
import { Button, Notice } from "../../components/ui";
import { colors, styles as theme } from "../../theme";
import type { Channel } from "../../domain/types";
import { channelTitle } from "../../domain/channelLabels";
import { sameChannel, type ChannelSheetProps } from "./playerShared";

/** Where the list was, so reopening it lands on the same rows. */
export interface SavedListPosition {
  range: string | null;
  channelId: string;
  offset: number;
}
/** Owned by the screen, since the panel unmounts whenever it is hidden. */
export interface ListPositionStore {
  get(): SavedListPosition | null;
  set(position: SavedListPosition): void;
}

interface ChannelPanelProps {
  sheet: ChannelSheetProps;
  channel: Channel;
  /** Fullscreen: a heading with close; portrait: the locate button inline. */
  fullscreen: boolean;
  onClose?: () => void;
  /** The chosen channel and the visible playable rows as its queue. */
  onSelect: (channel: Channel, queue: Channel[]) => void;
  onFavorite: (channel: Channel) => void;
  artworkEnabled: boolean;
  error?: string;
  onDismissError?: () => void;
  savedPosition: ListPositionStore;
}

const SCOPES = [
  ["all", "频道"],
  ["favorites", "收藏"],
  ["recent", "最近"],
] as const;

/**
 * Scope tabs, the page's filter bar and the channel list. Shown inline under
 * the picture in portrait and inside the side panel in fullscreen; mounted
 * only while visible, so mounting restores or locates the current channel.
 */
export function ChannelPanel(props: ChannelPanelProps) {
  const { sheet, channel, savedPosition } = props;
  const scope = sheet.filters.tab;
  const shownChannels = sheet.channels;
  const range = sheet.rangeKey;
  const channelList = useRef<FlatList<Channel>>(null);
  const scrollRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTarget = useRef<{ index: number; retries: number } | null>(null);
  const [locateRequest, setLocateRequest] = useState(0);
  const lastLocateRequest = useRef(0);
  const currentIndex = shownChannels.findIndex((row) =>
    sameChannel(row, channel),
  );
  const changeScope = (next: ListTab) => {
    if (next === scope) return;
    Keyboard.dismiss();
    sheet.onTabChange(next);
  };
  const selectRow = (row: Channel) =>
    props.onSelect(
      row,
      shownChannels.filter((candidate) => candidate.active),
    );
  const filtered =
    !!sheet.filters.search ||
    (scope === "all" &&
      (!!sheet.filters.sourceId ||
        Object.values(sheet.filters.facetSelection).some(
          (value) => value !== null,
        )));

  useEffect(() => {
    const previous = savedPosition.get();
    const forceLocate = lastLocateRequest.current !== locateRequest;
    lastLocateRequest.current = locateRequest;
    if (
      !forceLocate &&
      previous?.range === range &&
      previous.channelId === channel.id
    ) {
      channelList.current?.scrollToOffset({
        offset: previous.offset,
        animated: false,
      });
    } else {
      savedPosition.set({ range, channelId: channel.id, offset: 0 });
      if (currentIndex >= 0) {
        scrollTarget.current = { index: currentIndex, retries: 2 };
        channelList.current?.scrollToIndex({
          index: currentIndex,
          viewPosition: 0.35,
          animated: false,
        });
      } else {
        channelList.current?.scrollToOffset({ offset: 0, animated: false });
      }
    }
    return () => {
      if (scrollRetry.current !== null) clearTimeout(scrollRetry.current);
      scrollTarget.current = null;
    };
  }, [savedPosition, range, channel.id, currentIndex, locateRequest]);

  const locateButton = (
    <Pressable
      style={s.headingAction}
      accessibilityRole="button"
      accessibilityLabel="定位当前频道"
      accessibilityState={{ disabled: !channel.active }}
      disabled={!channel.active}
      onPress={() => {
        Keyboard.dismiss();
        if (currentIndex < 0) sheet.onLocate();
        setLocateRequest((value) => value + 1);
      }}
    >
      <Text style={s.headingActionText}>定位</Text>
    </Pressable>
  );

  return (
    <>
      {props.fullscreen && (
        <View style={s.heading}>
          <View style={s.flex}>
            <Text accessibilityRole="header" style={theme.heading}>
              选择频道
            </Text>
            <Text numberOfLines={1} style={theme.muted}>
              当前 · {channelTitle(channel.name).title}
            </Text>
          </View>
          {locateButton}
          <Pressable
            style={s.headingAction}
            accessibilityRole="button"
            accessibilityLabel="关闭频道列表"
            onPress={props.onClose}
          >
            <Text style={s.headingActionText}>关闭</Text>
          </Pressable>
        </View>
      )}
      <View style={s.scopes} testID="player-scopes">
        {SCOPES.map(([value, label]) => (
          <View key={value} style={s.flex}>
            <Button
              label={label}
              secondary={scope !== value}
              selected={scope === value}
              style={s.scopeButton}
              onPress={() => changeScope(value)}
            />
          </View>
        ))}
        {!props.fullscreen && locateButton}
      </View>
      <ChannelFilterBar
        key={scope}
        {...sheet.filters}
        idPrefix="player"
        compact
      />
      {!!props.error && (
        <View>
          <Notice title={props.error} error />
          <Button
            secondary
            label="关闭选台提示"
            onPress={() => props.onDismissError?.()}
          />
        </View>
      )}
      <FlatList
        ref={channelList}
        testID="player-channel-list"
        data={shownChannels}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(event) => {
          savedPosition.set({
            range,
            channelId: channel.id,
            offset: event.nativeEvent.contentOffset.y,
          });
        }}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => {
          if (scrollRetry.current !== null) clearTimeout(scrollRetry.current);
          scrollTarget.current = null;
        }}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          const target = scrollTarget.current;
          if (!target || target.index !== index) return;
          channelList.current?.scrollToOffset({
            offset: Math.max(0, averageItemLength * index),
            animated: false,
          });
          if (target.retries <= 0) return;
          target.retries -= 1;
          if (scrollRetry.current !== null) clearTimeout(scrollRetry.current);
          scrollRetry.current = setTimeout(() => {
            scrollRetry.current = null;
            if (scrollTarget.current === target) {
              channelList.current?.scrollToIndex({
                index,
                viewPosition: 0.35,
                animated: false,
              });
            }
          }, 100);
        }}
        keyExtractor={(item) => item.id}
        style={s.list}
        contentContainerStyle={s.listContent}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        updateCellsBatchingPeriod={16}
        windowSize={21}
        removeClippedSubviews={false}
        ListEmptyComponent={
          sheet.loading ? (
            <ActivityIndicator style={s.emptyLoading} color={colors.accent} />
          ) : (
            <Text style={s.empty}>
              {filtered
                ? `没有匹配频道，试试清除搜索${scope === "all" ? "或调整筛选" : ""}`
                : scope === "recent"
                  ? "还没有最近观看记录"
                  : scope === "favorites"
                    ? "还没有收藏的可用频道"
                    : "没有可用频道"}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <ChannelRow
            channel={item}
            current={sameChannel(item, channel)}
            onPlay={selectRow}
            onFavorite={props.onFavorite}
            artworkEnabled={props.artworkEnabled}
            flat
          />
        )}
      />
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  heading: { flexDirection: "row", alignItems: "center", gap: 4 },
  headingAction: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  headingActionText: { color: colors.accent, fontSize: 13, lineHeight: 20 },
  scopes: { flexDirection: "row", alignItems: "center", gap: 8 },
  scopeButton: { minHeight: 48, paddingVertical: 8, paddingHorizontal: 12 },
  list: { flex: 1 },
  listContent: { gap: 4 },
  empty: { color: colors.muted, paddingVertical: 24, textAlign: "center" },
  emptyLoading: { paddingVertical: 24 },
});
