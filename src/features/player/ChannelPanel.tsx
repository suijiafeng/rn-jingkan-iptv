import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  CHANNEL_ROW_GAP,
  ChannelRow,
  channelRowHeight,
  channelRowLayout,
} from "../../components/ChannelRow";
import { ChannelFilterBar } from "../channel/ChannelListParts";
import { Button, Notice } from "../../components/ui";
import { colors } from "../../theme";
import type { Channel } from "../../domain/types";
import { filteredGroup } from "../../domain/channelLabels";
import { sameChannel, type ChannelSheetProps } from "./playerShared";
import { CloseIcon, LocateIcon } from "./playerIcons";
import { LoadingTitle } from "./overlayWidgets";

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
  const rowHeight = channelRowHeight(useWindowDimensions().fontScale);
  const scrollRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTarget = useRef<{ index: number; retries: number } | null>(null);
  // Height the list last laid out at; 0 until the first layout.
  const listHeight = useRef(0);
  const [locateRequest, setLocateRequest] = useState(0);
  // One row of tabs only. The country/language choice is the page's and
  // stays folded here; a typed search is shown while active so it can be
  // cleared.
  const searchActive = !!sheet.filters.search;
  const hiddenGroup = filteredGroup(
    scope,
    sheet.filters.facetSelection.content,
  );
  const lastLocateRequest = useRef(0);
  const currentIndex = shownChannels.findIndex((row) =>
    sameChannel(row, channel),
  );
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
      style={styles.headingAction}
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
      <LocateIcon color={colors.accent} />
    </Pressable>
  );

  return (
    <>
      {props.fullscreen && (
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.headingTitle}>
            频道列表
          </Text>
          <View style={styles.flex} />
          {locateButton}
          <Pressable
            style={styles.headingAction}
            accessibilityRole="button"
            accessibilityLabel="关闭频道列表"
            onPress={props.onClose}
          >
            <CloseIcon />
          </Pressable>
        </View>
      )}
      {/* One row only, in both layouts: the content tabs. Search and the
          country/language triggers appear only while one of them is active,
          so a short list can always be explained and cleared. */}
      <ChannelFilterBar
        key={scope}
        {...sheet.filters}
        idPrefix="player"
        compact
        foldSearch={!searchActive}
        foldTriggers
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
        getItemLayout={(_data, index) => channelRowLayout(rowHeight, index)}
        onLayout={({ nativeEvent }) => {
          const { height } = nativeEvent.layout;
          if (height === listHeight.current) return;
          listHeight.current = height;
          // A scroll requested before the first layout placed the row as
          // if the list had no height, partly above its top edge (behind
          // the tabs). Place it again now that viewPosition can apply.
          const target = scrollTarget.current;
          if (target)
            channelList.current?.scrollToIndex({
              index: target.index,
              viewPosition: 0.35,
              animated: false,
            });
        }}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        updateCellsBatchingPeriod={16}
        windowSize={21}
        removeClippedSubviews={false}
        ListEmptyComponent={
          sheet.loading ? (
            <View style={styles.emptyLoading} accessibilityLiveRegion="polite">
              <LoadingTitle
                title="正在载入频道"
                style={styles.emptyLoadingText}
              />
            </View>
          ) : (
            <Text style={styles.empty}>
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
            hiddenGroup={hiddenGroup}
          />
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 4,
  },
  headingTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  headingAction: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { flex: 1 },
  listContent: { gap: CHANNEL_ROW_GAP },
  empty: { color: colors.muted, paddingVertical: 24, textAlign: "center" },
  emptyLoading: { paddingVertical: 24 },
  emptyLoadingText: { color: colors.muted },
});
