import React from "react";
import { FlatList } from "react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import {
  first,
  mockMounts,
  props,
  second,
  sheet,
} from "./support/playerTestKit";
import { PlayerScreen } from "../PlayerScreen";

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
  expect(ui.getByTestId("player-channel-list").props).toMatchObject({
    initialNumToRender: 12,
    maxToRenderPerBatch: 16,
    updateCellsBatchingPeriod: 16,
    windowSize: 21,
    removeClippedSubviews: false,
  });
  expect(
    within(ui.getByTestId("player-channel-list"))
      .getAllByRole("button", { name: /，(播放|节目单里已没有这个频道)$/ })
      .map((item) => item.props.accessibilityLabel),
  ).toEqual([
    "深夜电影，播放",
    "山野纪实，播放",
    "失效频道，节目单里已没有这个频道",
  ]);
  const current = ui.getByRole("button", { name: "山野纪实，播放" });
  expect(current.props.accessibilityState.selected).toBe(true);
  await fireEvent.press(
    ui.getByRole("button", { name: "失效频道，节目单里已没有这个频道" }),
  );
  expect(options.onSelect).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: "取消收藏深夜电影" }));
  expect(options.onFavorite).toHaveBeenCalledWith(outside);
  await fireEvent.press(current);
  expect(options.onSelect).toHaveBeenCalledWith(first, [outside, first]);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("the player shows the page's content tabs only; folded filters appear while active", async () => {
  const options = props({
    sheet: sheet([first, second], {
      facets: { countries: ["CN"], languages: ["zh"], contents: ["纪录片"] },
    }),
  });
  const ui = await render(<PlayerScreen {...options} />);
  // Portrait: one row, the content tabs; no scope row, search or triggers.
  expect(ui.queryByTestId("player-scopes")).toBeNull();
  expect(ui.queryByLabelText("搜索频道名称")).toBeNull();
  expect(ui.queryByRole("button", { name: /国家\/地区：/ })).toBeNull();
  const tabs = ui.getByTestId("player-facet-filters-content-tabs");
  await fireEvent.press(within(tabs).getByRole("button", { name: "纪录片" }));
  expect(options.sheet.filters.onFacetChange).toHaveBeenCalledWith(
    { country: null, language: null, content: "纪录片" },
    "content",
  );
  // The fullscreen panel is the same list with a heading, nothing more.
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
  expect(ui.getByRole("header", { name: "频道列表" })).toBeTruthy();
  expect(ui.queryByTestId("player-scopes")).toBeNull();
  expect(ui.queryByLabelText("搜索频道名称")).toBeNull();
  // An active search from the page is shown so it can be cleared here.
  const searching = sheet([second], { search: "自然", rangeKey: "search" });
  await ui.rerender(<PlayerScreen {...options} sheet={searching} />);
  await fireEvent.changeText(ui.getByLabelText("搜索频道名称"), "自然之");
  expect(searching.filters.onSearchChange).toHaveBeenCalledWith("自然之");
  await ui.unmount();
});

test("recent rows in the sheet have no history management actions", async () => {
  const options = props({ sheet: sheet([second, first], { tab: "recent" }) });
  const ui = await render(<PlayerScreen {...options} />);
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
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
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
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 1,
    viewPosition: 0.35,
    animated: false,
  });
  await fireEvent.scroll(ui.getByTestId("player-channel-list"), {
    nativeEvent: { contentOffset: { y: 240 } },
  });
  // Fullscreen hides the inline list; the side panel restores its offset.
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
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
  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 0,
    viewPosition: 0.35,
    animated: false,
  });
  await ui.unmount();
  indexSpy.mockRestore();
  offsetSpy.mockRestore();
});

test("the first layout places the current channel again, clear of the tabs", async () => {
  const indexSpy = jest
    .spyOn(FlatList.prototype, "scrollToIndex")
    .mockImplementation(() => {});
  const ui = await render(<PlayerScreen {...props({ channel: second })} />);
  const list = ui.getByTestId("player-channel-list");
  const callsBeforeLayout = indexSpy.mock.calls.length;
  await fireEvent(list, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 400 } },
  });
  expect(indexSpy).toHaveBeenCalledTimes(callsBeforeLayout + 1);
  expect(indexSpy).toHaveBeenLastCalledWith({
    index: 1,
    viewPosition: 0.35,
    animated: false,
  });
  // A drag hands the list to the viewer: later layouts leave it alone.
  await fireEvent(list, "scrollBeginDrag", {
    nativeEvent: { contentOffset: { y: 0 } },
  });
  await fireEvent(list, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } },
  });
  expect(indexSpy).toHaveBeenCalledTimes(callsBeforeLayout + 1);
  await ui.unmount();
  indexSpy.mockRestore();
});

test("sheet logos require both artwork permission and programme network permission", async () => {
  const channel = { ...first, logoUrl: "https://example.com/logo.png" };
  const initial = props({ channel, channels: [channel] });
  const ui = await render(<PlayerScreen {...initial} />);
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
  // Entering fullscreen hides the inline list and cancels the pending retry.
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  await act(() => jest.advanceTimersByTime(100));
  expect(indexSpy).toHaveBeenCalledTimes(callsBeforeRetry + 1);
  await ui.unmount();
  indexSpy.mockRestore();
  offsetSpy.mockRestore();
  jest.useRealTimers();
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
