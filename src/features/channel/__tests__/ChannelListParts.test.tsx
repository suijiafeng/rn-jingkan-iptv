import React from "react";
import { BackHandler } from "react-native";
import {
  act,
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
  // Folded menus: each set dimension is a chip that clears only itself.
  expect(screen.queryByText(/^国家\/地区 /)).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: /^清除国家\/地区筛选：/ }),
  );
  expect(callbacks.onFacetChange).toHaveBeenLastCalledWith(
    { country: null, language: "zh", content: "体育" },
    "country",
  );
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
  // With nothing to list the menus still have a way in.
  expect(
    screen.getByRole("button", { name: "按国家/地区或语言筛选" }),
  ).toBeTruthy();
});

test("the region basis is one small line atop the country menu only", async () => {
  await render(
    <ChannelListHeader {...props()} countryHint="依据：手机地区与时区设置" />,
  );
  expect(screen.queryByText("依据：手机地区与时区设置")).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: "按国家/地区或语言筛选" }),
  );
  await fireEvent.press(screen.getByTestId("channel-facet-filters-country"));
  expect(
    screen.getByTestId("channel-facet-filters-country-hint").props.children,
  ).toBe("依据：手机地区与时区设置");
  await fireEvent.press(screen.getByTestId("channel-facet-filters-language"));
  expect(screen.queryByTestId("channel-facet-filters-country-hint")).toBeNull();
});

test("recent management replaces search and exposes only its editing actions", async () => {
  const callbacks = props();
  const ui = await render(<ChannelListHeader {...callbacks} tab="recent" />);
  expect(screen.queryByRole("button", { name: "清空最近观看" })).toBeNull();
  expect(screen.queryByRole("button", { name: "完成历史管理" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "管理观看记录" }));
  expect(callbacks.onToggleRecentEditing).toHaveBeenCalledTimes(1);
  await ui.rerender(
    <ChannelListHeader {...callbacks} tab="recent" recentEditing />,
  );
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
    <ChannelListHeader {...callbacks} tab="recent" search="没有结果" />,
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
  expect(
    screen.getByRole("button", { name: "清除语言筛选：中文" }),
  ).toBeTruthy();
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
    onManageSources: jest.fn(),
  };
  const ui = await render(<ChannelListEmpty {...callbacks} />);
  expect(screen.getByText("还没有观看记录")).toBeTruthy();
  expect(screen.queryByText("成功播放过的频道会出现在这里。")).toBeNull();
  await ui.rerender(<ChannelListEmpty {...callbacks} filtered />);
  expect(screen.getByText("没有找到频道")).toBeTruthy();
  expect(screen.getByRole("button", { name: "查看全部频道" })).toBeTruthy();
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
      onManageSources={jest.fn()}
    />,
  );
  expect(screen.getByLabelText("正在加载频道列表")).toBeTruthy();
  expect(screen.getByText("正在读取频道…")).toBeTruthy();
});

test("sources without usable channels lead to source management", async () => {
  const onManageSources = jest.fn(),
    onShowAll = jest.fn();
  const props = {
    tab: "all" as const,
    loading: false,
    error: "",
    hasSources: true,
    filtered: false,
    onRetry: jest.fn(),
    onAddUrl: jest.fn(),
    onAddFile: jest.fn(),
    onShowAll,
    onManageSources,
  };
  const ui = await render(<ChannelListEmpty {...props} />);
  expect(screen.getByText("没有可用频道")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "查看全部频道" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "管理节目来源" }));
  expect(onManageSources).toHaveBeenCalledTimes(1);
  await ui.rerender(<ChannelListEmpty {...props} tab="favorites" />);
  expect(screen.queryByRole("button", { name: "管理节目来源" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "查看全部频道" }));
  expect(onShowAll).toHaveBeenCalledTimes(1);
});

test("the header carries no explanatory copy: scope on the chip, progress as a bar", async () => {
  const callbacks = props();
  await render(
    <ChannelListHeader
      {...callbacks}
      sourceId="other"
      autoCheck={{ done: 1, total: 4 }}
    />,
  );
  expect(screen.queryByText(/份节目单|范围：|检测可用性/)).toBeNull();
  expect(screen.getByText("另一个来源")).toBeTruthy();
  expect(
    screen.getByRole("progressbar", { name: "正在检测可用性" }).props
      .accessibilityValue,
  ).toEqual({ min: 0, max: 4, now: 1 });
  await fireEvent.press(screen.getByRole("button", { name: "清除来源筛选" }));
  expect(callbacks.onSourceChange).toHaveBeenCalledWith("");
});

test("a scope whose source is no longer listed can still be cleared", async () => {
  const callbacks = props();
  await render(
    <ChannelListHeader {...callbacks} sources={[source]} sourceId="gone" />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "清除来源筛选" }));
  expect(callbacks.onSourceChange).toHaveBeenCalledWith("");
});

test("the back key folds an expanded filter row before leaving the page", async () => {
  const listeners: (() => boolean | null | undefined)[] = [];
  const spy = jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation((_event, listener) => {
      const call = () =>
        listener({ type: "hardwareBackPress" } as Parameters<
          typeof listener
        >[0]);
      listeners.push(call);
      return {
        remove: () => listeners.splice(listeners.indexOf(call), 1),
      };
    });
  await render(<ChannelListHeader {...props()} />);
  // Folded: nothing claims the key, so the page keeps its own back.
  expect(listeners).toHaveLength(0);
  const toggle = screen.getByRole("button", { name: "按国家/地区或语言筛选" });
  await fireEvent.press(toggle);
  expect(screen.getByTestId("channel-facet-filters-country")).toBeTruthy();
  let handled: boolean | null | undefined;
  await act(() => {
    handled = listeners.at(-1)?.();
  });
  expect(handled).toBe(true);
  expect(screen.queryByTestId("channel-facet-filters-country")).toBeNull();
  expect(listeners).toHaveLength(0);
  // The source row folds the same way.
  await fireEvent.press(screen.getByRole("button", { name: "展开来源筛选" }));
  await act(() => {
    handled = listeners.at(-1)?.();
  });
  expect(handled).toBe(true);
  expect(screen.queryByRole("button", { name: "另一个来源" })).toBeNull();
  spy.mockRestore();
});
