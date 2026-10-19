import React from "react";
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { ChannelListEmpty, ChannelListHeader } from "../ChannelListParts";
import type { Source } from "../../../domain/types";

const source: Source = {
  id: "s",
  name: "自己的来源",
  kind: "file",
  enabled: true,
  location: "channels.m3u",
  createdAt: 1,
  lastSuccessAt: 1,
  lastErrorCategory: null,
  revision: 1,
  channelCount: 2,
  favoriteCount: 1,
  reachableCount: 0,
  unreachableCount: 0,
  lastCheckedAt: null,
};
function props() {
  return {
    tab: "all" as const,
    sources: [source, { ...source, id: "other", name: "另一个来源" }],
    channelCount: 2,
    search: "",
    sourceId: "",
    facets: {
      countries: ["CN", "US", ""],
      languages: ["zh", "en", ""],
      contents: ["新闻", "体育"],
    },
    facetSelection: { country: null, language: null, content: null } as {
      country: string | null;
      language: string | null;
      content: string | null;
    },
    onSearchChange: jest.fn(),
    onClearSearch: jest.fn(),
    onSourceChange: jest.fn(),
    onFacetChange: jest.fn(),
    onClearRecent: jest.fn(),
    recentBusy: false,
    recentEditing: false,
    onToggleRecentEditing: jest.fn(),
    recentCount: 2,
  };
}

function selectedContent(): string | undefined {
  const tabs = screen.getByTestId("channel-facet-filters-content-tabs");
  return within(tabs)
    .getAllByRole("button")
    .find((tab) => tab.props.accessibilityState?.selected)?.props
    .accessibilityLabel;
}

test("favorites and recent contain no duplicate category, source, or resume controls", async () => {
  const callbacks = props();
  const ui = await render(
    <ChannelListHeader
      {...callbacks}
      tab="favorites"
      sourceId="s"
      facetSelection={{ country: "CN", language: null, content: "体育" }}
    />,
  );
  expect(screen.getByRole("header", { name: "收藏" })).toBeTruthy();
  expect(screen.getByLabelText("搜索频道名称")).toBeTruthy();
  expect(screen.queryByTestId("channel-facet-filters")).toBeNull();
  expect(screen.queryByRole("button", { name: "展开来源筛选" })).toBeNull();
  expect(screen.queryByRole("button", { name: "清除来源筛选" })).toBeNull();
  expect(screen.queryByText(/继续观看|上次看到/)).toBeNull();
  await ui.rerender(
    <ChannelListHeader {...callbacks} tab="recent" sourceId="s" />,
  );
  expect(screen.getByRole("header", { name: "最近观看" })).toBeTruthy();
  expect(screen.getByLabelText("搜索频道名称")).toBeTruthy();
  expect(screen.queryByTestId("channel-facet-filters")).toBeNull();
  expect(screen.queryByRole("button", { name: "展开来源筛选" })).toBeNull();
  expect(screen.queryByRole("button", { name: "清除来源筛选" })).toBeNull();
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
      facetSelection={{ country: "CN", language: "zh", content: "体育" }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "清除搜索" }));
  expect(callbacks.onClearSearch).toHaveBeenCalledTimes(1);
  expect(callbacks.onSourceChange).not.toHaveBeenCalled();
  expect(selectedContent()).toBe("体育");
  await fireEvent.press(screen.getByRole("button", { name: "清除来源筛选" }));
  expect(callbacks.onSourceChange).toHaveBeenCalledWith("");
  expect(callbacks.onFacetChange).not.toHaveBeenCalled();
  expect(callbacks.onClearSearch).toHaveBeenCalledTimes(1);
});

test("each facet clears independently and keeps the source selection", async () => {
  const callbacks = props();
  const ui = await render(
    <ChannelListHeader
      {...callbacks}
      facetSelection={{ country: "CN", language: "zh", content: "体育" }}
      sourceId="s"
    />,
  );
  expect(screen.queryByRole("button", { name: "全部分组" })).toBeNull();
  expect(screen.queryByRole("button", { name: "最近" })).toBeNull();
  expect(screen.getByTestId("channel-facet-filters")).toBeTruthy();
  // One tap on the content tabs; tapping the selected tab clears it.
  const tabs = screen.getByTestId("channel-facet-filters-content-tabs");
  await fireEvent.press(within(tabs).getByRole("button", { name: "全部" }));
  expect(callbacks.onFacetChange).toHaveBeenCalledWith(
    { country: "CN", language: "zh", content: null },
    "content",
  );
  expect(callbacks.onSourceChange).not.toHaveBeenCalled();
  await ui.rerender(<ChannelListHeader {...callbacks} />);
  expect(screen.queryByRole("button", { name: "清除来源筛选" })).toBeNull();
  await ui.rerender(
    <ChannelListHeader
      {...callbacks}
      facets={{ countries: [], languages: [], contents: [] }}
    />,
  );
  expect(screen.getByTestId("channel-facet-filters")).toBeTruthy();
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

test("returning to channels restores the selected facets without duplicating controls", async () => {
  const callbacks = props();
  const selection = { country: "CN", language: "zh", content: "体育" };
  const ui = await render(
    <ChannelListHeader {...callbacks} facetSelection={selection} />,
  );
  expect(selectedContent()).toBe("体育");
  await ui.rerender(
    <ChannelListHeader
      {...callbacks}
      tab="favorites"
      facetSelection={selection}
    />,
  );
  expect(screen.queryByTestId("channel-facet-filters")).toBeNull();
  await ui.rerender(
    <ChannelListHeader {...callbacks} facetSelection={selection} />,
  );
  expect(selectedContent()).toBe("体育");
  expect(screen.getByRole("button", { name: "语言：中文" })).toBeTruthy();
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

test("loading channels shows a skeleton and status", async () => {
  await render(
    <ChannelListEmpty
      tab="all"
      loading
      error=""
      hasSources
      filtered={false}
      onRetry={jest.fn()}
      onAddUrl={jest.fn()}
      onAddFile={jest.fn()}
      onShowAll={jest.fn()}
    />,
  );
  expect(screen.getByLabelText("正在加载频道列表")).toBeTruthy();
  expect(screen.getByText("正在读取频道…")).toBeTruthy();
});
