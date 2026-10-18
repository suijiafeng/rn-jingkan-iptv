import React from "react";
import { AppState, BackHandler, FlatList, Keyboard } from "react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import { PlayerScreen, type PlayerScreenProps } from "../PlayerScreen";
import type { Channel } from "../../../domain/types";

const mockNetworkCheck = jest.fn();
const mockNetworkListeners = new Set<(state: object) => void>();
const mockMounts = jest.fn();
const mockUnmounts = jest.fn();
const mockLock = jest.fn();
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
const props = (more: Partial<PlayerScreenProps> = {}): PlayerScreenProps => ({
  channel: first,
  channels: [first, second],
  remoteAllowed: true,
  mobileWarning: true,
  onSelect: jest.fn(),
  onClose: jest.fn(),
  onFavorite: jest.fn(),
  onStarted: jest.fn(),
  ...more,
});
async function chooseContent(
  ui: Awaited<ReturnType<typeof render>>,
  label: string,
) {
  const tabs = ui.getByTestId("player-facet-filters-content-tabs");
  await fireEvent.press(within(tabs).getByRole("button", { name: label }));
}
function selectedContent(ui: Awaited<ReturnType<typeof render>>) {
  return within(ui.getByTestId("player-facet-filters-content-tabs"))
    .getAllByRole("button")
    .find((tab) => tab.props.accessibilityState?.selected)?.props
    .accessibilityLabel;
}
beforeEach(() => {
  jest.clearAllMocks();
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
  await fireEvent.press(
    ui.getByRole("button", { name: "自然之声，我的节目单" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(second, [first, second]);
  expect(ui.queryByText("选择频道")).toBeNull();
  expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
  expect(mockLock).toHaveBeenLastCalledWith(0);
});

test("all channels uses the full active catalog while previous/next keep the playback queue", async () => {
  const inactive = {
    ...second,
    id: "inactive",
    name: "失效频道",
    active: false,
  };
  const options = props({
    channels: [first],
    allChannels: [first, second, inactive],
  });
  const ui = await render(<PlayerScreen {...options} />);
  expect(
    ui.getByRole("button", { name: "下一台" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(ui.queryByRole("button", { name: "失效频道，我的节目单" })).toBeNull();
  await fireEvent.press(
    ui.getByRole("button", { name: "自然之声，我的节目单" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(second, [first, second]);
  expect(ui.queryByText("选择频道")).toBeNull();
  await ui.unmount();
});

test("favorites includes channels outside the initial playback queue and passes its own queue", async () => {
  const options = props({ channels: [first], allChannels: [first, second] });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent.press(ui.getByRole("button", { name: "收藏" }));
  expect(
    ui.queryByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeNull();
  await fireEvent.press(
    ui.getByRole("button", { name: "自然之声，我的节目单" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(second, [second]);
  await ui.unmount();
});

test("choosing the current channel still updates the selected playback range", async () => {
  const options = props({ channels: [first], allChannels: [first, second] });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent.press(
    ui.getByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(first, [first, second]);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
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

test("sheet search matches the full catalog and clearing search restores its channels", async () => {
  const outside = { ...second, sourceName: "私有音乐单" };
  const options = props({ channels: [first], allChannels: [first, outside] });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "音乐单");
  expect(
    ui.queryByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeNull();
  await fireEvent.press(
    ui.getByRole("button", { name: "自然之声，私有音乐单" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(outside, [outside]);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent.press(ui.getByRole("button", { name: "清除选台搜索" }));
  expect(
    ui.getByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeTruthy();
  expect(ui.getByLabelText("搜索选台频道").props.value).toBe("");
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("sheet groups split multiple categories and selection uses the visible queue", async () => {
  const music = { ...second, groupName: "纪录片;音乐" };
  const options = props({ channels: [first], allChannels: [first, music] });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(
    within(ui.getByTestId("player-facet-filters"))
      .getAllByRole("button")
      .map((item) => item.props.accessibilityLabel),
  ).toEqual(["国家/地区：全部", "语言：全部"]);
  expect(selectedContent(ui)).toBe("全部");
  await chooseContent(ui, "音乐");
  expect(selectedContent(ui)).toBe("音乐");
  expect(
    ui.queryByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeNull();
  await fireEvent.press(
    ui.getByRole("button", { name: "自然之声，我的节目单" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(music, [music]);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("all groups restores the channel queue while keeping its search and repeating a selected group preserves its filter", async () => {
  const music = { ...second, groupName: "音乐" };
  const news = {
    ...second,
    id: "news",
    identityKey: "news",
    name: "地方新闻",
    groupName: "新闻",
    streamUrl: "https://example.test/news.m3u8",
    sortIndex: 2,
  };
  const options = props({
    channels: [first],
    allChannels: [first, music, news],
  });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await chooseContent(ui, "音乐");
  await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "我的节目单");
  expect(ui.queryByRole("button", { name: "地方新闻，我的节目单" })).toBeNull();
  await chooseContent(ui, "音乐");
  expect(selectedContent(ui)).toBe("音乐");
  expect(ui.queryByRole("button", { name: "地方新闻，我的节目单" })).toBeNull();
  await chooseContent(ui, "全部");
  expect(selectedContent(ui)).toBe("全部");
  expect(selectedContent(ui)).toBe("全部");
  expect(ui.getByLabelText("搜索选台频道").props.value).toBe("我的节目单");
  expect(
    ui.getByRole("button", { name: "频道" }).props.accessibilityState.selected,
  ).toBe(true);
  expect(
    ui.getByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeTruthy();
  await fireEvent.press(
    ui.getByRole("button", { name: "地方新闻，我的节目单" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(news, [first, music, news]);
  await ui.unmount();
});

test("channel, favorite and recent scopes are mutually exclusive and groups belong only to channels", async () => {
  const options = props({ recentChannels: [first] });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(
    within(ui.getByTestId("player-scopes"))
      .getAllByRole("button")
      .map((item) => item.props.accessibilityLabel),
  ).toEqual(["频道", "收藏", "最近"]);
  for (const label of ["频道", "收藏", "最近", "频道"]) {
    await fireEvent.press(ui.getByRole("button", { name: label }));
    expect(
      within(ui.getByTestId("player-scopes"))
        .getAllByRole("button")
        .filter((item) => item.props.accessibilityState.selected)
        .map((item) => item.props.accessibilityLabel),
    ).toEqual([label]);
    expect(!!ui.queryByTestId("player-facet-filters")).toBe(label === "频道");
  }
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("country, language and content intersect while favorites ignore channel facets", async () => {
  const local = { ...first, countries: ["CN"], languages: ["zh"] };
  const foreign = {
    ...second,
    countries: ["US"],
    languages: ["en"],
    groupName: "音乐",
  };
  const bilingual = {
    ...second,
    id: "bilingual",
    countries: ["CN", "SG"],
    languages: ["en", "zh"],
    groupName: "音乐;纪录片",
  };
  const options = props({
    channel: local,
    allChannels: [local, foreign, bilingual],
    countryCode: "CN",
  });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent.press(ui.getByTestId("player-facet-filters-language"));
  await fireEvent.press(ui.getByRole("button", { name: "英语" }));
  await chooseContent(ui, "音乐");
  expect(
    within(ui.getByTestId("player-channel-list")).getAllByRole("button", {
      name: /，我的节目单/,
    }),
  ).toHaveLength(1);
  await fireEvent.press(ui.getByRole("button", { name: "收藏" }));
  expect(
    within(ui.getByTestId("player-channel-list")).getAllByRole("button", {
      name: /，我的节目单/,
    }),
  ).toHaveLength(2);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("locating a channel bypasses country locally without changing the saved choice", async () => {
  const local = { ...first, countries: ["CN"] };
  const foreign = { ...second, countries: ["US"] };
  const onCountryChange = jest.fn();
  const ui = await render(
    <PlayerScreen
      {...props({
        allChannels: [local, foreign],
        countryCode: "US",
        onCountryChange,
      })}
    />,
  );
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  expect(
    ui.queryByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: "定位当前频道" }));
  expect(
    ui.getByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeTruthy();
  expect(
    ui.getByTestId("player-facet-filters-country").props.accessibilityLabel,
  ).toBe("国家/地区：全部");
  expect(onCountryChange).not.toHaveBeenCalled();
  await ui.unmount();
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

test("recent uses ordered complete history outside the initial queue and favorite scope without history management actions", async () => {
  const outside = {
    ...first,
    id: "outside",
    identityKey: "outside",
    name: "深夜电影",
    groupName: "电影",
    streamUrl: "https://example.test/outside.m3u8",
  };
  const inactive = {
    ...first,
    id: "inactive",
    identityKey: "inactive",
    name: "旧纪录片",
    active: false,
  };
  const options = props({
    channels: [first],
    allChannels: [first, second, outside],
    recentChannels: [outside, second, inactive],
  });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await chooseContent(ui, "纪录片");
  await fireEvent.press(ui.getByRole("button", { name: "收藏" }));
  await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "不存在");
  await fireEvent.press(ui.getByRole("button", { name: "最近" }));
  expect(ui.getByLabelText("搜索选台频道").props.value).toBe("");
  expect(ui.queryByTestId("player-facet-filters")).toBeNull();
  expect(
    ui.queryByRole("button", { name: /删除.*的观看记录|清空最近观看/ }),
  ).toBeNull();
  expect(
    within(ui.getByTestId("player-channel-list"))
      .getAllByRole("button", { name: /，我的节目单/ })
      .map((item) => item.props.accessibilityLabel),
  ).toEqual([
    "深夜电影，我的节目单",
    "自然之声，我的节目单",
    "旧纪录片，我的节目单",
  ]);
  expect(
    ui.getByRole("button", { name: "旧纪录片，我的节目单" }).props
      .accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(
    ui.getByRole("button", { name: "旧纪录片，我的节目单" }),
  );
  expect(options.onSelect).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: "收藏深夜电影" }));
  expect(options.onFavorite).toHaveBeenCalledWith(outside);
  expect(ui.getByText("选择频道")).toBeTruthy();
  await fireEvent.press(
    ui.getByRole("button", { name: "自然之声，我的节目单" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(second, [outside, second]);
  await ui.unmount();
});

test("changing scope clears search and group while pressing the current scope preserves them", async () => {
  const music = { ...second, groupName: "音乐" };
  const keyboardSpy = jest
    .spyOn(Keyboard, "dismiss")
    .mockImplementation(() => {});
  const ui = await render(
    <PlayerScreen
      {...props({
        allChannels: [first, music],
        recentChannels: [music, first],
      })}
    />,
  );
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await chooseContent(ui, "音乐");
  await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "自然");
  keyboardSpy.mockClear();
  await fireEvent.press(ui.getByRole("button", { name: "频道" }));
  expect(selectedContent(ui)).toBe("音乐");
  expect(ui.getByLabelText("搜索选台频道").props.value).toBe("自然");
  expect(keyboardSpy).not.toHaveBeenCalled();
  for (const label of ["收藏", "最近", "频道"]) {
    await fireEvent.press(ui.getByRole("button", { name: label }));
    expect(ui.getByLabelText("搜索选台频道").props.value).toBe("");
    expect(keyboardSpy).toHaveBeenCalledTimes(1);
    await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "音乐");
    await fireEvent.press(ui.getByRole("button", { name: label }));
    expect(ui.getByLabelText("搜索选台频道").props.value).toBe("音乐");
    expect(keyboardSpy).toHaveBeenCalledTimes(1);
    keyboardSpy.mockClear();
  }
  expect(selectedContent(ui)).toBe("全部");
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
  keyboardSpy.mockRestore();
});

test("recent search filters its queue and clear search restores the recent order", async () => {
  const music = { ...second, groupName: "音乐" };
  const options = props({
    allChannels: [first, music],
    recentChannels: [music, first],
  });
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent.press(ui.getByRole("button", { name: "最近" }));
  await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "没有这个节目");
  expect(ui.getByText("没有匹配频道，试试清除搜索")).toBeTruthy();
  await fireEvent.press(ui.getByRole("button", { name: "清除选台搜索" }));
  expect(
    within(ui.getByTestId("player-channel-list"))
      .getAllByRole("button", { name: /，我的节目单/ })
      .map((item) => item.props.accessibilityLabel),
  ).toEqual(["自然之声，我的节目单", "山野纪实，我的节目单，当前频道"]);
  await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "音乐");
  expect(
    ui.queryByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeNull();
  await fireEvent.press(
    ui.getByRole("button", { name: "自然之声，我的节目单" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(music, [music]);
  await ui.unmount();
});

test("locating the current channel leaves recent when history or its search hides it", async () => {
  const indexSpy = jest
    .spyOn(FlatList.prototype, "scrollToIndex")
    .mockImplementation(() => {});
  const ui = await render(
    <PlayerScreen {...props({ recentChannels: [second] })} />,
  );
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent.press(ui.getByRole("button", { name: "最近" }));
  await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "自然");
  await fireEvent.press(ui.getByRole("button", { name: "定位当前频道" }));
  expect(ui.getByLabelText("搜索选台频道").props.value).toBe("");
  expect(
    ui.getByRole("button", { name: "最近" }).props.accessibilityState.selected,
  ).toBe(false);
  expect(
    ui.getByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeTruthy();
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 0,
    viewPosition: 0.35,
    animated: false,
  });
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
  indexSpy.mockRestore();
});

test("locating the current channel clears search, favorite scope and group when they hide it", async () => {
  const indexSpy = jest
    .spyOn(FlatList.prototype, "scrollToIndex")
    .mockImplementation(() => {});
  const music = { ...second, groupName: "音乐" };
  const ui = await render(
    <PlayerScreen {...props({ allChannels: [first, music] })} />,
  );
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await chooseContent(ui, "音乐");
  await fireEvent.press(ui.getByRole("button", { name: "收藏" }));
  await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "自然");
  await fireEvent.press(ui.getByRole("button", { name: "定位当前频道" }));
  expect(ui.getByLabelText("搜索选台频道").props.value).toBe("");
  expect(
    ui.getByRole("button", { name: "频道" }).props.accessibilityState.selected,
  ).toBe(true);
  expect(selectedContent(ui)).toBe("全部");
  expect(selectedContent(ui)).toBe("全部");
  expect(selectedContent(ui)).toBe("全部");
  expect(
    ui.getByRole("button", { name: "山野纪实，我的节目单，当前频道" }),
  ).toBeTruthy();
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 0,
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
  await fireEvent.changeText(ui.getByLabelText("搜索选台频道"), "没有这个频道");
  expect(offsetSpy).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  expect(ui.getByText("没有匹配频道，试试清除搜索或调整筛选")).toBeTruthy();
  await fireEvent.press(ui.getByRole("button", { name: "清除选台搜索" }));
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

test("submitting search or choosing a group dismisses the keyboard without closing the sheet", async () => {
  const keyboardSpy = jest
    .spyOn(Keyboard, "dismiss")
    .mockImplementation(() => {});
  const ui = await render(<PlayerScreen {...props()} />);
  await fireEvent.press(ui.getByRole("button", { name: "打开频道列表" }));
  await fireEvent(ui.getByLabelText("搜索选台频道"), "submitEditing");
  expect(keyboardSpy).toHaveBeenCalledTimes(1);
  await chooseContent(ui, "纪录片");
  expect(keyboardSpy).toHaveBeenCalledTimes(2);
  expect(ui.getByText("选择频道")).toBeTruthy();
  await ui.unmount();
  keyboardSpy.mockRestore();
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
