import React, { useState, type RefObject } from "react";
import {
  Animated,
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { Channel } from "../../domain/types";
import { filteredGroup } from "../../domain/channelLabels";
import {
  CHANNEL_ROW_GAP,
  ChannelRow,
  channelRowHeight,
  channelRowLayout,
} from "../../components/ChannelRow";
import { colors, styles as theme } from "../../theme";
import {
  ChannelFilterBar,
  ChannelListEmpty,
  ChannelListTitle,
  type HeaderProps,
} from "../channel/ChannelListParts";
import {
  channelListKey,
  EMPTY_ROW,
  type ChannelListItem,
} from "./channelListItems";

/** Bar height plus its margins, reserved under the list while docked. */
const MINI_BAR_SPACE = 88;
/** Space between the header overlay and the first row. */
const LIST_TOP_GAP = 12;

const ListSeparator = () => <View style={{ height: CHANNEL_ROW_GAP }} />;

export interface ChannelListEmptyActions {
  hasSources: boolean;
  filtered: boolean;
  onRetry: () => void;
  onAddUrl: () => void;
  onAddFile: () => void;
  onShowAll: () => void;
}

/**
 * The channel page: a virtualized list under a pinned title and filter bar.
 * The title + filter bar sit in an overlay above the list (so taps land on
 * them, not on rows scrolled underneath, which is what an in-list
 * stickyHeaderIndices row did on Android) and slide up by the title height
 * as the list scrolls.
 */
export function ChannelListPage({
  listRef,
  scrollY,
  onListScroll,
  onScrollBeginDrag,
  onScrollSettled,
  listLoading,
  listError,
  headerProps,
  rows,
  emptyActions,
  artworkEnabled,
  onPlay,
  onFavorite,
  onRemoveRecent,
  recentBusy,
  reserveMiniBar,
}: {
  listRef: RefObject<FlatList<ChannelListItem> | null>;
  /** Native-driven scroll offset that collapses the title. */
  scrollY: Animated.Value;
  onListScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag: () => void;
  /** A drag or fling settled at this offset. */
  onScrollSettled: (offsetY: number) => void;
  listLoading: boolean;
  listError: string;
  headerProps: HeaderProps;
  rows: Channel[];
  emptyActions: ChannelListEmptyActions;
  artworkEnabled: boolean;
  onPlay: (channel: Channel) => void;
  onFavorite: (channel: Channel) => void;
  onRemoveRecent?: (channel: Channel) => void;
  recentBusy: boolean;
  /** Keeps the last rows clear of the docked player bar. */
  reserveMiniBar: boolean;
}) {
  // Channel rows grow with the font scale; see channelRowHeight.
  const { fontScale } = useWindowDimensions();
  const [headerHeight, setHeaderHeight] = useState(0),
    [titleSpace, setTitleSpace] = useState(0);
  const listData: ChannelListItem[] = rows.length ? rows : [EMPTY_ROW];
  const listTop = headerHeight + LIST_TOP_GAP;
  const hiddenGroup = filteredGroup(
    headerProps.tab,
    headerProps.facetSelection.content,
  );
  const headerCollapse = scrollY.interpolate({
    inputRange: [0, Math.max(1, titleSpace)],
    outputRange: [0, -titleSpace],
    extrapolate: "clamp",
  });
  return (
    // Clip: the collapsing title must not slide over the status bar.
    <View style={pageStyles.clip}>
      <Animated.FlatList<ChannelListItem>
        testID="channel-list"
        ref={listRef}
        data={listData}
        extraData={headerProps}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={onListScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        // Each tab's offset is recorded when a drag or fling settles.
        onScrollEndDrag={(event) =>
          onScrollSettled(event.nativeEvent.contentOffset.y)
        }
        onMomentumScrollEnd={(event) =>
          onScrollSettled(event.nativeEvent.contentOffset.y)
        }
        scrollEventThrottle={16}
        keyExtractor={channelListKey}
        // Rows share one height, so the list places them without measuring;
        // a cell also holds the separator below it. Render far enough ahead
        // of a fast Android fling as well.
        getItemLayout={(_items, index) => {
          const layout = channelRowLayout(
            channelRowHeight(fontScale),
            index,
            listTop,
          );
          return { ...layout, length: layout.length + CHANNEL_ROW_GAP };
        }}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        updateCellsBatchingPeriod={16}
        windowSize={21}
        removeClippedSubviews={false}
        contentContainerStyle={[
          theme.content,
          // Rows are spaced by the separator alone, as getItemLayout assumes;
          // the page's content gap would add 12dp per row unaccounted for.
          { paddingTop: listTop, gap: 0 },
          reserveMiniBar && { paddingBottom: MINI_BAR_SPACE },
        ]}
        ItemSeparatorComponent={ListSeparator}
        renderItem={({ item }) =>
          item === EMPTY_ROW ? (
            <ChannelListEmpty
              tab={headerProps.tab}
              loading={listLoading}
              error={listError}
              {...emptyActions}
            />
          ) : (
            <ChannelRow
              channel={item as Channel}
              artworkEnabled={artworkEnabled}
              onPlay={onPlay}
              onFavorite={onFavorite}
              onRemoveRecent={onRemoveRecent}
              recentBusy={recentBusy}
              hiddenGroup={hiddenGroup}
            />
          )
        }
      />
      <Animated.View
        testID="channel-header-overlay"
        style={[
          pageStyles.headerOverlay,
          { transform: [{ translateY: headerCollapse }] },
        ]}
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
      >
        <View
          onLayout={(event) =>
            // Title plus the gap above the bar collapses away.
            setTitleSpace(event.nativeEvent.layout.height + 20)
          }
        >
          <ChannelListTitle {...headerProps} />
        </View>
        <ChannelFilterBar key={headerProps.tab} {...headerProps} />
      </Animated.View>
    </View>
  );
}

const pageStyles = StyleSheet.create({
  clip: { flex: 1, overflow: "hidden" },
  headerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 20,
    paddingHorizontal: 20,
    backgroundColor: colors.bg,
  },
});
