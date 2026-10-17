import React from "react";
import { ScrollView } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import {
  BottomTabs,
  ChannelListEmpty,
  ChannelListHeader,
} from "../ChannelListParts";
import type { Source } from "../../../domain/types";

const source: Source = {
  id: "s",
  name: "自己的来源",
  kind: "file",
  location: "channels.m3u",
  createdAt: 1,
  lastSuccessAt: 1,
  lastErrorCategory: null,
  revision: 1,
  channelCount: 2,
  favoriteCount: 1,
};
function props() {
  return {
    tab: "all" as const,
    sources: [source, { ...source, id: "other", name: "另一个来源" }],
    channelCount: 2,
    search: "",
    sourceId: "",
    group: "",
    groups: ["新闻", "体育"],
    onSearchChange: jest.fn(),
    onClearSearch: jest.fn(),
    onSourceChange: jest.fn(),
    onGroupChange: jest.fn(),
    onClearRecent: jest.fn(),
    recentBusy: false,
    recentEditing: false,
    onToggleRecentEditing: jest.fn(),
    recentCount: 2,
  };
}

test("favorites and recent contain no duplicate category, source, or resume controls", async () => {
  const callbacks = props();
  const ui = await render(
    <ChannelListHeader
      {...callbacks}
      tab="favorites"
      sourceId="s"
      group="体育"
    />,
  );
  expect(screen.getByRole("header", { name: "收藏" })).toBeTruthy();
  expect(screen.getByLabelText("搜索频道名称")).toBeTruthy();
  expect(screen.queryByTestId("channel-group-tabs")).toBeNull();
  expect(screen.queryByRole("button", { name: "展开来源筛选" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "清空来源和分组筛选" }),
  ).toBeNull();
  expect(screen.queryByText(/继续观看|上次看到/)).toBeNull();
  await ui.rerender(
    <ChannelListHeader {...callbacks} tab="recent" sourceId="s" group="体育" />,
  );
  expect(screen.getByRole("header", { name: "最近观看" })).toBeTruthy();
  expect(screen.getByLabelText("搜索频道名称")).toBeTruthy();
  expect(screen.queryByTestId("channel-group-tabs")).toBeNull();
  expect(screen.queryByRole("button", { name: "展开来源筛选" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "清空来源和分组筛选" }),
  ).toBeNull();
});

test("channel sources expand on demand and selecting one collapses the chooser", async () => {
  const callbacks = props();
  const ui = await render(<ChannelListHeader {...callbacks} />);
  expect(screen.getByRole("header", { name: "频道" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "另一个来源" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "展开来源筛选" }));
  expect(
    screen.getByRole("button", { name: "所有来源" }).props.accessibilityState
      .selected,
  ).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "另一个来源" }));
  expect(callbacks.onSourceChange).toHaveBeenCalledWith("other");
  expect(screen.queryByRole("button", { name: "另一个来源" })).toBeNull();
  await ui.rerender(<ChannelListHeader {...callbacks} sourceId="other" />);
  expect(
    screen.getByRole("button", { name: "展开来源筛选" }).props
      .accessibilityState.expanded,
  ).toBe(false);
});

test("search clear and channel scope reset preserve their distinct actions", async () => {
  const callbacks = props();
  await render(
    <ChannelListHeader
      {...callbacks}
      search="新闻"
      sourceId="s"
      group="体育"
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "清除搜索" }));
  expect(callbacks.onClearSearch).toHaveBeenCalledTimes(1);
  expect(callbacks.onSourceChange).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "体育" }).props.accessibilityState
      .selected,
  ).toBe(true);
  await fireEvent.press(
    screen.getByRole("button", { name: "清空来源和分组筛选" }),
  );
  expect(callbacks.onSourceChange).toHaveBeenCalledWith("");
  expect(callbacks.onGroupChange).toHaveBeenCalledWith("");
  expect(callbacks.onClearSearch).toHaveBeenCalledTimes(1);
});

test("all clears the category without changing sources and repeated category taps keep selection", async () => {
  const callbacks = props();
  const ui = await render(
    <ChannelListHeader {...callbacks} group="体育" sourceId="s" />,
  );
  expect(screen.queryByRole("button", { name: "全部分组" })).toBeNull();
  expect(screen.queryByRole("button", { name: "最近" })).toBeNull();
  expect(screen.getByTestId("channel-group-tabs").props.horizontal).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "体育" }));
  expect(callbacks.onGroupChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "全部" }));
  expect(callbacks.onGroupChange).toHaveBeenCalledWith("");
  expect(callbacks.onSourceChange).not.toHaveBeenCalled();
  await ui.rerender(<ChannelListHeader {...callbacks} group="体育" />);
  expect(
    screen.queryByRole("button", { name: "清空来源和分组筛选" }),
  ).toBeNull();
  await ui.rerender(<ChannelListHeader {...callbacks} groups={[]} />);
  expect(screen.queryByTestId("channel-group-tabs")).toBeNull();
});

test("recent management replaces search and exposes only its editing actions", async () => {
  const callbacks = props();
  const ui = await render(<ChannelListHeader {...callbacks} tab="recent" />);
  expect(screen.getByText("按最近播放排序")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "清空最近观看" })).toBeNull();
  expect(screen.queryByRole("button", { name: "完成历史管理" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "管理观看记录" }));
  expect(callbacks.onToggleRecentEditing).toHaveBeenCalledTimes(1);
  await ui.rerender(
    <ChannelListHeader {...callbacks} tab="recent" recentEditing />,
  );
  expect(screen.getByText("删除记录不会影响频道和收藏")).toBeTruthy();
  expect(screen.queryByLabelText("搜索频道名称")).toBeNull();
  expect(screen.queryByRole("button", { name: "管理观看记录" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "清空最近观看" }));
  expect(callbacks.onClearRecent).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "完成历史管理" }));
  expect(callbacks.onToggleRecentEditing).toHaveBeenCalledTimes(2);
});

test("recent actions use the full history count and disable mutations while busy", async () => {
  const callbacks = props();
  const ui = await render(
    <ChannelListHeader {...callbacks} tab="recent" recentCount={0} />,
  );
  expect(screen.getByRole("button", { name: "管理观看记录" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "管理观看记录" }));
  expect(callbacks.onToggleRecentEditing).not.toHaveBeenCalled();
  await ui.rerender(
    <ChannelListHeader
      {...callbacks}
      tab="recent"
      search="没有结果"
      channelCount={0}
    />,
  );
  expect(
    screen.getByRole("button", { name: "管理观看记录" }),
  ).not.toBeDisabled();
  await ui.rerender(
    <ChannelListHeader {...callbacks} tab="recent" recentEditing recentBusy />,
  );
  expect(screen.getByRole("button", { name: "清空最近观看" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "完成历史管理" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "清空最近观看" }));
  expect(callbacks.onClearRecent).not.toHaveBeenCalled();
  await ui.rerender(
    <ChannelListHeader
      {...callbacks}
      tab="recent"
      recentEditing
      recentCount={0}
    />,
  );
  expect(screen.getByRole("button", { name: "清空最近观看" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "完成历史管理" }),
  ).not.toBeDisabled();
});

test("returning to channels restores its saved category to the visible region", async () => {
  const scroll = jest
    .spyOn(ScrollView.prototype, "scrollTo")
    .mockImplementation(() => {});
  const callbacks = props();
  const layoutGroupStrip = async () => {
    const strip = screen.getByTestId("channel-group-tabs");
    await fireEvent(strip, "layout", {
      nativeEvent: { layout: { width: 100 } },
    });
    await fireEvent(strip, "contentSizeChange", 260, 48);
    await fireEvent(screen.getByTestId("channel-group-tabs-item-1"), "layout", {
      nativeEvent: { layout: { x: 160, width: 100 } },
    });
  };
  try {
    const ui = await render(<ChannelListHeader {...callbacks} group="体育" />);
    await layoutGroupStrip();
    expect(scroll).toHaveBeenLastCalledWith({ x: 160, animated: false });
    await ui.rerender(
      <ChannelListHeader {...callbacks} tab="favorites" group="体育" />,
    );
    scroll.mockClear();
    await ui.rerender(<ChannelListHeader {...callbacks} group="体育" />);
    await layoutGroupStrip();
    expect(scroll).toHaveBeenLastCalledWith({ x: 160, animated: false });
  } finally {
    scroll.mockRestore();
  }
});

test("empty history and an empty search have distinct next steps", async () => {
  const callbacks = {
    tab: "recent" as const,
    loading: false,
    error: "",
    hasSources: true,
    filtered: false,
    onRetry: jest.fn(),
    onAddUrl: jest.fn(),
    onAddFile: jest.fn(),
    onShowAll: jest.fn(),
  };
  const ui = await render(<ChannelListEmpty {...callbacks} />);
  expect(screen.getByText("还没有观看记录")).toBeTruthy();
  expect(screen.getByText("成功播放过的频道会出现在这里。")).toBeTruthy();
  await ui.rerender(<ChannelListEmpty {...callbacks} filtered />);
  expect(screen.getByText("没有找到频道")).toBeTruthy();
  expect(screen.getByText("试试清空搜索或筛选条件。")).toBeTruthy();
});

test("bottom navigation has one ordered entry per destination and repeated taps preserve it", async () => {
  const change = jest.fn();
  await render(<BottomTabs tab="favorites" onChange={change} />);
  expect(
    screen.getAllByRole("tab").map((tab) => tab.props.accessibilityLabel),
  ).toEqual(["频道", "收藏", "最近", "设置"]);
  const favorites = screen.getByRole("tab", { name: "收藏" });
  expect(favorites.props.accessibilityState.selected).toBe(true);
  await fireEvent.press(favorites);
  expect(change).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  expect(change).toHaveBeenCalledWith("all");
});
