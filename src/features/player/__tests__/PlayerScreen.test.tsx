import React from "react";
import {
  AppState,
  BackHandler,
  FlatList,
  Keyboard,
  StyleSheet,
} from "react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import {
  PlayerScreen,
  type ChannelSheetProps,
  type PlayerScreenProps,
} from "../PlayerScreen";
import type { HeaderProps } from "../../channel/ChannelListParts";
import type { Channel } from "../../../domain/types";

const mockNetworkCheck = jest.fn();
const mockNetworkListeners = new Set<(state: object) => void>();
const mockMounts = jest.fn();
const mockUnmounts = jest.fn();
const mockLock = jest.fn();
const mockSafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => mockNetworkCheck(),
  addNetworkStateListener: (listener: (state: object) => void) => {
    mockNetworkListeners.add(listener);
    return { remove: () => mockNetworkListeners.delete(listener) };
  },
}));
jest.mock("expo-screen-orientation", () => ({
  OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 1, LANDSCAPE: 2 },
  getOrientationLockAsync: async () => 0,
  lockAsync: (lock: number) => mockLock(lock),
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView:
    jest.requireActual<typeof import("react-native")>("react-native").View,
  useSafeAreaInsets: () => mockSafeAreaInsets,
}));
jest.mock("../NativeAttempt", () => ({
  NativeAttempt: function MockNativeAttempt(props: {
    attemptId: number;
    uri: string;
  }) {
    const { View } =
      jest.requireActual<typeof import("react-native")>("react-native");
    const { useEffect } = jest.requireActual<typeof import("react")>("react");
    useEffect(() => {
      mockMounts(props.uri);
      return () => {
        mockUnmounts(props.uri);
      };
    }, [props.uri]);
    return <View testID="mock-native-attempt" />;
  },
}));
const first: Channel = {
  id: "first",
  identityKey: "one",
  sourceId: "source",
  sourceName: "我的节目单",
  active: true,
  lastSeenRevision: 1,
  lastPlayedAt: null,
  checkStatus: null,
  checkedAt: null,
  name: "山野纪实",
  groupName: "纪录片",
  streamUrl: "https://example.test/one.m3u8",
  logoUrl: null,
  tvgId: null,
  sortIndex: 0,
  favorite: false,
};
const second: Channel = {
  ...first,
  id: "second",
  identityKey: "two",
  name: "自然之声",
  streamUrl: "https://example.test/two.m3u8",
  sortIndex: 1,
  favorite: true,
};
/** The page's state as App hands it to the sheet. */
function sheet(
  channels: Channel[],
  more: Partial<
    Pick<HeaderProps, "tab" | "search" | "facets"> &
      Pick<ChannelSheetProps, "rangeKey" | "loading">
  > = {},
): ChannelSheetProps {
  const tab = more.tab ?? "all";
  return {
    filters: {
      tab,
      sources: [],
      channelCount: channels.length,
      search: more.search ?? "",
      sourceId: "",
      facets: more.facets ?? { countries: [], languages: [], contents: [] },
      facetSelection: { country: null, language: null, content: null },
      onSearchChange: jest.fn(),
      onClearSearch: jest.fn(),
      onSourceChange: jest.fn(),
      onFacetChange: jest.fn(),
      onClearRecent: jest.fn(),
      recentBusy: false,
      recentEditing: false,
      onToggleRecentEditing: jest.fn(),
      recentCount: 0,
    },
    onTabChange: jest.fn(),
    channels,
    rangeKey: more.rangeKey === undefined ? tab : more.rangeKey,
    loading: more.loading ?? false,
    onLocate: jest.fn(),
  };
}
const props = (more: Partial<PlayerScreenProps> = {}): PlayerScreenProps => ({
  channel: first,
  channels: [first, second],
  sheet: sheet(more.channels ?? [first, second]),
  remoteAllowed: true,
  mobileWarning: true,
  onSelect: jest.fn(),
  onClose: jest.fn(),
  onFavorite: jest.fn(),
  onStarted: jest.fn(),
  ...more,
  sources: more.sources ?? [more.channel ?? first],
  onSelectSource: more.onSelectSource ?? jest.fn(),
});
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockSafeAreaInsets, {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  mockNetworkListeners.clear();
  mockNetworkCheck.mockResolvedValue({ type: "WIFI", isConnected: true });
  mockLock.mockResolvedValue(undefined);
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    writable: true,
    value: "active",
  });
});

test("remote consent prevents all loading, including HTTPS, and revocation tears down", async () => {
  const initial = props({ remoteAllowed: false });
  const ui = await render(<PlayerScreen {...initial} />);
  expect(mockMounts).not.toHaveBeenCalled();
  expect(mockNetworkCheck).not.toHaveBeenCalled();
  await ui.rerender(<PlayerScreen {...initial} remoteAllowed />);
  expect(mockMounts).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: "播放" }));
  expect(mockMounts).toHaveBeenCalledWith(first.streamUrl);
  await ui.rerender(<PlayerScreen {...initial} />);
  expect(mockUnmounts).toHaveBeenCalledWith(first.streamUrl);
  expect(ui.queryByTestId("mock-native-attempt")).toBeNull();
  await ui.unmount();
});

test("the video is edge-to-edge and alternative sources can be selected", async () => {
  const low: Channel = {
    ...first,
    groupKey: "iptv:cctv1.cn",
    qualityLabel: "标清",
    qualityRank: 576,
  };
  const high: Channel = {
    ...low,
    id: "high",
    streamUrl: "https://example.test/high.m3u8",
    sourceName: "备用节目单",
    qualityLabel: "高清",
    qualityRank: 720,
  };
  const onSelectSource = jest.fn();
  const ui = await render(
    <PlayerScreen
      {...props({
        channel: low,
        sources: [low, high],
        onSelectSource,
      })}
    />,
  );
  expect(ui.getByTestId("video-stage").props.style).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ borderRadius: expect.any(Number) }),
    ]),
  );
  await fireEvent.press(ui.getByRole("button", { name: "播放来源 2" }));
  await fireEvent.press(
    within(ui.getByTestId("source-list")).getByRole("button", {
      name: "高清，备用节目单",
    }),
  );
  expect(onSelectSource).toHaveBeenCalledWith(high);
});

test("mobile transition unmounts before confirmation and decline stays stopped", async () => {
  const ui = await render(<PlayerScreen {...props()} />);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await act(() => {
    mockNetworkListeners.forEach((listener) =>
      listener({ type: "CELLULAR", isConnected: true }),
    );
  });
  expect(mockUnmounts).toHaveBeenCalledTimes(1);
  expect(ui.queryByTestId("mock-native-attempt")).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: "暂不播放" }));
  await act(() => {
    mockNetworkListeners.forEach((listener) =>
      listener({ type: "WIFI", isConnected: true }),
    );
  });
  expect(mockMounts).toHaveBeenCalledTimes(1);
  expect(ui.getByRole("button", { name: "播放" })).toBeTruthy();
  await ui.unmount();
});

test("rotation preserves the current attempt; choosing a channel closes the sheet and stays fullscreen", async () => {
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  expect(mockLock).toHaveBeenLastCalledWith(2);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
  expect(ui.getByText("选择频道")).toBeTruthy();
  await fireEvent.press(ui.getByRole("button", { name: "自然之声，播放" }));
  expect(options.onSelect).toHaveBeenCalledWith(second, [first, second]);
  expect(ui.queryByText("选择频道")).toBeNull();
  expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
  expect(mockLock).toHaveBeenLastCalledWith(0);
});

test("fullscreen media stays edge-to-edge while controls and sheets respect display insets", async () => {
  Object.assign(mockSafeAreaInsets, {
    top: 11,
    right: 13,
    bottom: 17,
    left: 19,
  });
  const ui = await render(
    <PlayerScreen {...props({ sources: [first, second] })} />,
  );
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));

  expect(ui.getByTestId("player-screen").props.edges).toEqual([]);
  expect(StyleSheet.flatten(ui.getByTestId("video-stage").props.style)).toMatchObject(
    { top: 0, right: 0, bottom: 0, left: 0 },
  );
  expect(
    StyleSheet.flatten(ui.getByTestId("fullscreen-controls").props.style),
  ).toMatchObject({ top: 27, right: 37, left: 43 });
  expect(
    StyleSheet.flatten(ui.getByTestId("fullscreen-gesture-layer").props.style),
  ).toMatchObject({ right: 13 });

  await fireEvent.press(ui.getByRole("button", { name: "来源 2" }));
  expect(
    StyleSheet.flatten(ui.getByTestId("fullscreen-sources").props.style),
  ).toMatchObject({ top: 93, right: 37, bottom: 33 });

  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
  expect(
    StyleSheet.flatten(ui.getByTestId("player-channel-sheet").props.style),
  ).toMatchObject({ marginTop: 11, marginRight: 13, marginBottom: 17 });
  await ui.unmount();
});

test("the sheet shows the page's result in its order; the visible playable rows become the queue", async () => {
  const inactive = {
    ...second,
    id: "inactive",
    name: "失效频道",
    active: false,
  };
  const outside = { ...second, id: "outside", name: "深夜电影" };
  const options = props({
    channels: [first],
    sheet: sheet([outside, first, inactive]),
  });
  const ui = await render(<PlayerScreen {...options} />);
  expect(
    ui.getByRole("button", { name: "下一台" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(ui.getByTestId("player-channel-list").props).toMatchObject({
    initialNumToRender: 12,
    maxToRenderPerBatch: 16,
    updateCellsBatchingPeriod: 16,
    windowSize: 21,
    removeClippedSubviews: false,
  });
  expect(
    within(ui.getByTestId("player-channel-list"))
      .getAllByRole("button", { name: /，(播放|来源已不再提供)$/ })
      .map((item) => item.props.accessibilityLabel),
  ).toEqual(["深夜电影，播放", "山野纪实，播放", "失效频道，来源已不再提供"]);
  const current = ui.getByRole("button", { name: "山野纪实，播放" });
  expect(current.props.accessibilityState.selected).toBe(true);
  await fireEvent.press(
    ui.getByRole("button", { name: "失效频道，来源已不再提供" }),
  );
  expect(options.onSelect).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: "取消收藏深夜电影" }));
  expect(options.onFavorite).toHaveBeenCalledWith(outside);
  await fireEvent.press(current);
  expect(options.onSelect).toHaveBeenCalledWith(first, [outside, first]);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("the sheet uses the page's filter bar and switches the page's tab", async () => {
  const keyboardSpy = jest
    .spyOn(Keyboard, "dismiss")
    .mockImplementation(() => {});
  const options = props({
    sheet: sheet([first, second], {
      facets: { countries: ["CN"], languages: ["zh"], contents: ["纪录片"] },
    }),
  });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(
    within(ui.getByTestId("player-scopes"))
      .getAllByRole("button")
      .map((item) => item.props.accessibilityLabel),
  ).toEqual(["频道", "收藏", "最近"]);
  expect(
    within(ui.getByTestId("player-facet-filters"))
      .getAllByRole("button")
      .map((item) => item.props.accessibilityLabel),
  ).toEqual(["国家/地区：全部", "语言：全部"]);
  await fireEvent.changeText(ui.getByLabelText("搜索频道名称"), "自然");
  expect(options.sheet.filters.onSearchChange).toHaveBeenCalledWith("自然");
  const tabs = ui.getByTestId("player-facet-filters-content-tabs");
  await fireEvent.press(within(tabs).getByRole("button", { name: "纪录片" }));
  expect(options.sheet.filters.onFacetChange).toHaveBeenCalledWith(
    { country: null, language: null, content: "纪录片" },
    "content",
  );
  await fireEvent.press(ui.getByRole("button", { name: "频道" }));
  expect(options.sheet.onTabChange).not.toHaveBeenCalled();
  expect(keyboardSpy).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: "收藏" }));
  expect(options.sheet.onTabChange).toHaveBeenCalledWith("favorites");
  expect(keyboardSpy).toHaveBeenCalledTimes(1);
  await ui.rerender(
    <PlayerScreen {...options} sheet={sheet([second], { tab: "favorites" })} />,
  );
  expect(
    ui.getByRole("button", { name: "收藏" }).props.accessibilityState.selected,
  ).toBe(true);
  expect(ui.queryByTestId("player-facet-filters")).toBeNull();
  expect(ui.getByLabelText("搜索频道名称")).toBeTruthy();
  expect(ui.getByText("选择频道")).toBeTruthy();
  await ui.unmount();
  keyboardSpy.mockRestore();
});

test("recent rows in the sheet have no history management actions", async () => {
  const options = props({ sheet: sheet([second, first], { tab: "recent" }) });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(
    ui.queryByRole("button", {
      name: /删除.*的观看记录|清空最近观看|管理观看记录/,
    }),
  ).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: "自然之声，播放" }));
  expect(options.onSelect).toHaveBeenCalledWith(second, [second, first]);
  await ui.unmount();
});

test("empty sheet: loading shows progress, otherwise a hint matching the filters", async () => {
  const options = props({ sheet: sheet([], { loading: true }) });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(ui.queryByText(/没有/)).toBeNull();
  await ui.rerender(
    <PlayerScreen {...options} sheet={sheet([], { search: "无" })} />,
  );
  expect(ui.getByText("没有匹配频道，试试清除搜索或调整筛选")).toBeTruthy();
  await ui.rerender(
    <PlayerScreen {...options} sheet={sheet([], { tab: "recent" })} />,
  );
  expect(ui.getByText("还没有最近观看记录")).toBeTruthy();
  await ui.unmount();
});

test("locating asks the page to show everything only when the current channel is hidden", async () => {
  const indexSpy = jest
    .spyOn(FlatList.prototype, "scrollToIndex")
    .mockImplementation(() => {});
  const options = props({ sheet: sheet([second], { tab: "favorites" }) });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent.press(ui.getByRole("button", { name: "定位当前频道" }));
  expect(options.sheet.onLocate).toHaveBeenCalledTimes(1);
  // The page reloads: nothing while loading, then the full list.
  await ui.rerender(
    <PlayerScreen
      {...options}
      sheet={sheet([], { rangeKey: null, loading: true })}
    />,
  );
  await ui.rerender(
    <PlayerScreen
      {...options}
      sheet={sheet([second, first], { rangeKey: "everything" })}
    />,
  );
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 1,
    viewPosition: 0.35,
    animated: false,
  });
  const located = options.sheet.onLocate as jest.Mock;
  located.mockClear();
  await fireEvent.press(ui.getByRole("button", { name: "定位当前频道" }));
  expect(located).not.toHaveBeenCalled();
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 1,
    viewPosition: 0.35,
    animated: false,
  });
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
  indexSpy.mockRestore();
});

test("sheet restores its offset until the range or current channel changes", async () => {
  const indexSpy = jest
    .spyOn(FlatList.prototype, "scrollToIndex")
    .mockImplementation(() => {});
  const offsetSpy = jest
    .spyOn(FlatList.prototype, "scrollToOffset")
    .mockImplementation(() => {});
  const options = props({ channel: second });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 1,
    viewPosition: 0.35,
    animated: false,
  });
  await fireEvent.scroll(ui.getByTestId("player-channel-list"), {
    nativeEvent: { contentOffset: { y: 240 } },
  });
  await fireEvent.press(ui.getByRole("button", { name: "关闭频道列表" }));
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(offsetSpy).toHaveBeenLastCalledWith({ offset: 240, animated: false });
  await ui.rerender(
    <PlayerScreen {...options} sheet={sheet([], { rangeKey: "search" })} />,
  );
  expect(offsetSpy).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  await ui.rerender(<PlayerScreen {...options} />);
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 1,
    viewPosition: 0.35,
    animated: false,
  });
  await fireEvent.press(ui.getByRole("button", { name: "关闭频道列表" }));
  await ui.rerender(<PlayerScreen {...options} channel={first} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 0,
    viewPosition: 0.35,
    animated: false,
  });
  await ui.unmount();
  indexSpy.mockRestore();
  offsetSpy.mockRestore();
});

test("previous/next honor queue boundaries and switching releases prior channel", async () => {
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  expect(
    ui.getByRole("button", { name: "上一台" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  await fireEvent.press(ui.getByRole("button", { name: "下一台" }));
  expect(options.onSelect).toHaveBeenCalledWith(second);
  await ui.rerender(<PlayerScreen {...options} channel={second} />);
  expect(mockUnmounts).toHaveBeenCalledWith(first.streamUrl);
  expect(mockMounts).toHaveBeenLastCalledWith(second.streamUrl);
  expect(
    ui.getByRole("button", { name: "下一台" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  await ui.unmount();
});

test("hardware back closes sheet, then fullscreen, then player", async () => {
  let handler: (() => boolean | null | undefined) | undefined;
  const spy = jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation((_event, listener) => {
      handler = () =>
        listener({ type: "hardwareBackPress" } as Parameters<
          typeof listener
        >[0]);
      return { remove: jest.fn() };
    });
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
  await act(() => {
    handler?.();
  });
  expect(ui.queryByText("选择频道")).toBeNull();
  expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
  await act(() => {
    handler?.();
  });
  expect(ui.getByRole("button", { name: "横屏全屏" })).toBeTruthy();
  expect(options.onClose).not.toHaveBeenCalled();
  await act(() => {
    handler?.();
  });
  expect(options.onClose).toHaveBeenCalledTimes(1);
  await ui.unmount();
  spy.mockRestore();
});

test("sheet logos require both artwork permission and programme network permission", async () => {
  const channel = { ...first, logoUrl: "https://example.com/logo.png" };
  const initial = props({ channel, channels: [channel] });
  const ui = await render(<PlayerScreen {...initial} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(
    ui.queryByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeNull();
  await ui.rerender(<PlayerScreen {...initial} artworkEnabled />);
  expect(
    ui.getByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeTruthy();
  await ui.rerender(
    <PlayerScreen {...initial} artworkEnabled remoteAllowed={false} />,
  );
  expect(
    ui.queryByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeNull();
  await ui.unmount();
});

test("variable-height current-channel scrolling falls back and cancels retries on close", async () => {
  jest.useFakeTimers();
  const indexSpy = jest
    .spyOn(FlatList.prototype, "scrollToIndex")
    .mockImplementation(() => {});
  const offsetSpy = jest
    .spyOn(FlatList.prototype, "scrollToOffset")
    .mockImplementation(() => {});
  const ui = await render(<PlayerScreen {...props({ channel: second })} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent(
    ui.getByTestId("player-channel-list"),
    "scrollToIndexFailed",
    {
      index: 1,
      highestMeasuredFrameIndex: 0,
      averageItemLength: 94,
    },
  );
  expect(offsetSpy).toHaveBeenLastCalledWith({ offset: 94, animated: false });
  const callsBeforeRetry = indexSpy.mock.calls.length;
  await act(() => jest.advanceTimersByTime(100));
  expect(indexSpy).toHaveBeenCalledTimes(callsBeforeRetry + 1);
  await fireEvent(
    ui.getByTestId("player-channel-list"),
    "scrollToIndexFailed",
    {
      index: 1,
      highestMeasuredFrameIndex: 0,
      averageItemLength: 94,
    },
  );
  await fireEvent.press(ui.getByRole("button", { name: "关闭频道列表" }));
  await act(() => jest.advanceTimersByTime(100));
  expect(indexSpy).toHaveBeenCalledTimes(callsBeforeRetry + 1);
  await ui.unmount();
  indexSpy.mockRestore();
  offsetSpy.mockRestore();
  jest.useRealTimers();
});

test("fullscreen has one accessible favorite shortcut and toggling it preserves native playback", async () => {
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  expect(
    ui.getAllByRole("button", {
      name: "收藏当前频道",
      includeHiddenElements: true,
    }),
  ).toHaveLength(1);
  await fireEvent.press(ui.getByRole("button", { name: "收藏当前频道" }));
  expect(options.onFavorite).toHaveBeenCalledWith(first);
  await ui.rerender(
    <PlayerScreen {...options} channel={{ ...first, favorite: true }} />,
  );
  expect(
    ui.getByRole("button", { name: "取消收藏当前频道" }).props
      .accessibilityState.selected,
  ).toBe(true);
  expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  expect(mockUnmounts).not.toHaveBeenCalled();
  await ui.unmount();
});

test("manual list dragging cancels a pending automatic location retry", async () => {
  jest.useFakeTimers();
  const indexSpy = jest
    .spyOn(FlatList.prototype, "scrollToIndex")
    .mockImplementation(() => {});
  const offsetSpy = jest
    .spyOn(FlatList.prototype, "scrollToOffset")
    .mockImplementation(() => {});
  const ui = await render(<PlayerScreen {...props({ channel: second })} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent(
    ui.getByTestId("player-channel-list"),
    "scrollToIndexFailed",
    {
      index: 1,
      highestMeasuredFrameIndex: 0,
      averageItemLength: 94,
    },
  );
  const initialCalls = indexSpy.mock.calls.length;
  await fireEvent(ui.getByTestId("player-channel-list"), "scrollBeginDrag", {
    nativeEvent: { contentOffset: { y: 94 } },
  });
  await act(() => jest.advanceTimersByTime(100));
  expect(indexSpy).toHaveBeenCalledTimes(initialCalls);
  await ui.unmount();
  indexSpy.mockRestore();
  offsetSpy.mockRestore();
  jest.useRealTimers();
});

describe("zapping", () => {
  const third: Channel = {
    ...first,
    id: "third",
    identityKey: "three",
    name: "城市夜色",
    streamUrl: "https://example.test/three.m3u8",
    sortIndex: 2,
  };
  const swipe = async (
    ui: Awaited<ReturnType<typeof render>>,
    dy: number,
    dx = 0,
  ) => {
    const layer = ui.getByTestId("fullscreen-gesture-layer");
    await act(() => {
      layer.props.onResponderGrant({ nativeEvent: { pageX: 100, pageY: 300 } });
      layer.props.onResponderRelease({
        nativeEvent: { pageX: 100 + dx, pageY: 300 + dy },
      });
    });
  };
  const fullscreen = async (options: PlayerScreenProps) => {
    const ui = await render(<PlayerScreen {...options} />);
    await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
    return ui;
  };

  test("fullscreen swipe up selects the next channel and down the previous", async () => {
    const options = props({
      channel: second,
      channels: [first, second, third],
    });
    const ui = await fullscreen(options);
    await swipe(ui, -120);
    expect(options.onSelect).toHaveBeenLastCalledWith(third);
    await swipe(ui, 120);
    expect(options.onSelect).toHaveBeenLastCalledWith(first);
    await ui.unmount();
  });

  test("reverse setting flips swipe direction; mostly horizontal drags do nothing", async () => {
    const options = props({
      channel: second,
      channels: [first, second, third],
      swipeReverse: true,
    });
    const ui = await fullscreen(options);
    await swipe(ui, -120);
    expect(options.onSelect).toHaveBeenLastCalledWith(first);
    await swipe(ui, -80, 200);
    expect(options.onSelect).toHaveBeenCalledTimes(1);
    await ui.unmount();
  });

  test("a tap toggles controls and swiping past the end shows a boundary hint", async () => {
    const options = props({ channel: second, channels: [first, second] });
    const ui = await fullscreen(options);
    expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
    await swipe(ui, 0);
    expect(ui.queryByRole("button", { name: "退出全屏" })).toBeNull();
    await swipe(ui, -120);
    expect(options.onSelect).not.toHaveBeenCalled();
    expect(ui.getByText("已经是最后一个频道")).toBeTruthy();
    await ui.unmount();
  });

  test("TalkBack actions switch channels without gestures", async () => {
    const options = props({
      channel: second,
      channels: [first, second, third],
    });
    const ui = await fullscreen(options);
    const layer = ui.getByTestId("fullscreen-gesture-layer");
    await act(() =>
      layer.props.onAccessibilityAction({
        nativeEvent: { actionName: "increment" },
      }),
    );
    expect(options.onSelect).toHaveBeenLastCalledWith(third);
    await ui.unmount();
  });

  test("previous/next and swipes skip channels last checked unreachable when enabled", async () => {
    const dead = { ...second, checkStatus: "unreachable" as const };
    const options = props({
      channel: first,
      channels: [first, dead, third],
      skipUnreachable: true,
    });
    const ui = await render(<PlayerScreen {...options} />);
    await fireEvent.press(ui.getByRole("button", { name: "下一台" }));
    expect(options.onSelect).toHaveBeenLastCalledWith(third);
    await ui.unmount();
    const plain = props({ channel: first, channels: [first, dead, third] });
    const ui2 = await render(<PlayerScreen {...plain} />);
    await fireEvent.press(ui2.getByRole("button", { name: "下一台" }));
    expect(plain.onSelect).toHaveBeenLastCalledWith(dead);
    await ui2.unmount();
  });

  test("returning to the previous channel is one tap and hidden for the same or inactive channel", async () => {
    const options = props({ previousChannel: second });
    const ui = await render(<PlayerScreen {...options} />);
    await fireEvent.press(
      ui.getByRole("button", { name: "回到上一个频道 自然之声" }),
    );
    expect(options.onSelect).toHaveBeenLastCalledWith(second);
    await ui.rerender(
      <PlayerScreen
        {...options}
        previousChannel={{ ...second, active: false }}
      />,
    );
    expect(ui.queryByRole("button", { name: /回到上一个频道/ })).toBeNull();
    await ui.rerender(<PlayerScreen {...options} previousChannel={first} />);
    expect(ui.queryByRole("button", { name: /回到上一个频道/ })).toBeNull();
    await ui.unmount();
  });
});

describe("waiting and failure", () => {
  afterEach(() => jest.useRealTimers());

  // The counter re-arms after each render, so advance one second at a time.
  const seconds = async (n: number) => {
    for (let i = 0; i < n; i += 1)
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
  };

  test("connecting shows elapsed seconds; with hidden fullscreen controls it offers the next channel after 15 s", async () => {
    jest.useFakeTimers();
    const options = props();
    const ui = await render(<PlayerScreen {...options} />);
    await seconds(3);
    expect(ui.getByText("已等待 3 秒")).toBeTruthy();
    await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
    const layer = ui.getByTestId("fullscreen-gesture-layer");
    await act(() => {
      layer.props.onResponderGrant({ nativeEvent: { pageX: 10, pageY: 10 } });
      layer.props.onResponderRelease({ nativeEvent: { pageX: 10, pageY: 10 } });
    });
    expect(ui.queryByRole("button", { name: "退出全屏" })).toBeNull();
    expect(ui.queryByRole("button", { name: "换下一台" })).toBeNull();
    await seconds(12);
    expect(ui.getByText(/比平时慢/)).toBeTruthy();
    await fireEvent.press(ui.getByRole("button", { name: "换下一台" }));
    expect(options.onSelect).toHaveBeenLastCalledWith(second);
    await ui.unmount();
  });

  test("portrait loading never duplicates the visible next button", async () => {
    jest.useFakeTimers();
    const ui = await render(<PlayerScreen {...props()} />);
    await seconds(16);
    expect(ui.getByText(/比平时慢/)).toBeTruthy();
    expect(ui.queryByRole("button", { name: "换下一台" })).toBeNull();
    expect(ui.getByRole("button", { name: "下一台" })).toBeTruthy();
    await ui.unmount();
  });

  test("after a timeout, retry starts a fresh attempt and a second timeout does not hang", async () => {
    jest.useFakeTimers();
    const options = props();
    const ui = await render(<PlayerScreen {...options} />);
    await seconds(30);
    expect(ui.getByText("连接超时")).toBeTruthy();
    const mountsBefore = mockMounts.mock.calls.length;
    await fireEvent.press(ui.getByRole("button", { name: "重试播放" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockMounts.mock.calls.length).toBe(mountsBefore + 1);
    await seconds(30);
    expect(ui.getByText("连接超时")).toBeTruthy();
    await fireEvent.press(ui.getByRole("button", { name: "下一台" }));
    expect(options.onSelect).toHaveBeenLastCalledWith(second);
    await ui.unmount();
  });
});
