import React from "react";
import {
  mockPlayerProps,
  repo,
  chooseFacet,
  selectedContent,
  setupRecentHistory,
  resetAppMocks,
} from "./support/appTestKit";
import { Alert, BackHandler } from "react-native";
import {
  fireEvent,
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import App from "../src/App";

beforeEach(resetAppMocks);

test.each(["频道", "最近"])(
  "a pending unfavorite cannot remove a channel after switching to %s",
  async (destination) => {
    const channel = {
      id: "c",
      name: "频道A",
      sourceId: "s",
      sourceName: "测试来源",
      groupName: "未分组",
      active: true,
      favorite: true,
    };
    let favorite = true;
    (repo.listChannels as jest.Mock).mockImplementation(async (query) =>
      query?.mode === "favorites" && !favorite
        ? []
        : [{ ...channel, favorite }],
    );
    (repo.listSources as jest.Mock).mockResolvedValue([
      { id: "s", name: "测试来源" },
    ]);
    let finish!: () => void;
    repo.toggleFavorite.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            favorite = false;
            resolve(false);
          };
        }),
    );
    await render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText("取消收藏频道A")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByLabelText("取消收藏频道A"));
    await fireEvent.press(screen.getByRole("tab", { name: destination }));
    await waitFor(() =>
      expect(screen.getByLabelText("频道A，播放")).toBeTruthy(),
    );
    await act(async () => finish());
    await waitFor(() =>
      expect(screen.getByLabelText("收藏频道A")).toBeTruthy(),
    );
    expect(screen.getByLabelText("频道A，播放")).toBeTruthy();
    expect(screen.queryByText("没有可用频道")).toBeNull();
    await fireEvent.press(screen.getByText("收藏", { exact: true }));
    await waitFor(() => expect(screen.getByText("还没有收藏")).toBeTruthy());
  },
);
test("favorites has no duplicate continue-watching shortcut and recent keeps unavailable entries", async () => {
  const available = {
    id: "available",
    name: "可用频道",
    active: true,
    favorite: true,
    sourceName: "自己的来源",
    groupName: "未分组",
  };
  const unavailable = {
    ...available,
    id: "gone",
    name: "失效频道",
    active: false,
  };
  (repo.listChannels as jest.Mock).mockImplementation(async (query) =>
    query?.mode === "recent" ? [unavailable, available] : [available],
  );
  await render(<App />);
  expect(await screen.findByLabelText("可用频道，播放")).toBeTruthy();
  expect(screen.queryByText("继续观看")).toBeNull();
  expect(screen.queryByTestId("channel-facet-filters")).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "最近" }));
  expect(
    await screen.findByLabelText("失效频道，节目单里已没有这个频道"),
  ).toBeTruthy();
  expect(screen.queryByLabelText("删除失效频道的观看记录")).toBeNull();
});
test("favoriting on the channel tab patches the row without re-reading the list", async () => {
  const channel = {
    id: "a",
    name: "台A",
    active: true,
    favorite: false,
    sourceId: "s",
    sourceName: "来源",
    groupName: "新闻",
  };
  (repo.listChannels as jest.Mock).mockImplementation(async (query) =>
    query?.mode === "favorites" || query?.mode === "recent" ? [] : [channel],
  );
  repo.toggleFavorite.mockResolvedValue(true);
  await render(<App />);
  const star = await screen.findByLabelText("收藏台A");
  await waitFor(() => expect(repo.listSources).toHaveBeenCalled());
  const reads = (repo.listChannels as jest.Mock).mock.calls.length;
  const sourceReads = repo.listSources.mock.calls.length;
  await fireEvent.press(star);
  await waitFor(() =>
    expect(screen.getByLabelText("取消收藏台A")).toBeTruthy(),
  );
  // Only source counts (favoriteCount) are re-read, not the channel list.
  await waitFor(() =>
    expect(repo.listSources).toHaveBeenCalledTimes(sourceReads + 1),
  );
  expect(repo.listChannels).toHaveBeenCalledTimes(reads);
  await fireEvent.press(screen.getByText("收藏", { exact: true }));
  await waitFor(() =>
    expect(repo.listChannels).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "favorites" }),
    ),
  );
});

test("navigation separates types from history and restores channel filters without hiding recent entries", async () => {
  setupRecentHistory();
  await render(<App />);
  expect(await screen.findByLabelText("最新新闻台，播放")).toBeTruthy();
  expect(screen.queryByTestId("channel-facet-filters")).toBeNull();
  await fireEvent.press(await screen.findByRole("tab", { name: "频道" }));
  await chooseFacet("内容", "体育");
  await fireEvent.changeText(screen.getByLabelText("搜索频道名称"), "体育");
  expect(screen.queryByRole("button", { name: "最近" })).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "最近" }));
  await waitFor(() =>
    expect(
      screen.getByLabelText("旧频道，节目单里已没有这个频道"),
    ).toBeTruthy(),
  );
  expect(screen.getByLabelText("搜索频道名称").props.value).toBe("");
  expect(screen.getByLabelText("最新新闻台，播放")).toBeTruthy();
  expect(screen.getByLabelText("体育台，播放")).toBeTruthy();
  expect(screen.queryByTestId("channel-facet-filters")).toBeNull();
  expect(screen.queryByRole("button", { name: "展开来源筛选" })).toBeNull();
  expect(
    screen.getByRole("tab", { name: "最近" }).props.accessibilityState.selected,
  ).toBe(true);
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  expect(screen.getByLabelText("搜索频道名称").props.value).toBe("体育");
  await waitFor(() =>
    expect(screen.getByLabelText("体育台，播放")).toBeTruthy(),
  );
  expect(screen.queryByLabelText("最新新闻台，播放")).toBeNull();
  expect(selectedContent()).toBe("体育");
});

test("the all-type filter clears only the category while keeping the selected source", async () => {
  setupRecentHistory();
  await render(<App />);
  await fireEvent.press(await screen.findByRole("tab", { name: "频道" }));
  await fireEvent.press(
    await screen.findByRole("button", { name: "展开来源筛选" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "自己的来源" }));
  await chooseFacet("内容", "体育");
  await waitFor(() =>
    expect(screen.queryByLabelText("最新新闻台，播放")).toBeNull(),
  );
  repo.listChannels.mockClear();
  await chooseFacet("内容", "全部");
  expect(await screen.findByLabelText("最新新闻台，播放")).toBeTruthy();
  expect(screen.getByLabelText("体育台，播放")).toBeTruthy();
  expect(repo.listChannels).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "all",
      sourceId: "s1",
      groupName: undefined,
    }),
  );
  expect(selectedContent()).toBe("全部");
});

test("history deletion failures preserve the row and allow retry without changing favorites or channels", async () => {
  const { latest } = setupRecentHistory();
  repo.removeRecent.mockRejectedValueOnce(new Error("disk failure"));
  await render(<App />);
  await fireEvent.press(await screen.findByRole("tab", { name: "最近" }));
  expect(screen.queryByLabelText("删除最新新闻台的观看记录")).toBeNull();
  await fireEvent.press(await screen.findByLabelText("管理观看记录"));
  await fireEvent.press(
    await screen.findByLabelText("删除最新新闻台的观看记录"),
  );
  await waitFor(() =>
    expect(screen.getByText("删除观看记录失败，请重试")).toBeTruthy(),
  );
  expect(screen.getByLabelText("删除最新新闻台的观看记录")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("删除最新新闻台的观看记录"));
  await waitFor(() =>
    expect(screen.queryByLabelText("删除最新新闻台的观看记录")).toBeNull(),
  );
  expect(repo.removeRecent).toHaveBeenCalledTimes(2);
  expect(repo.removeRecent).toHaveBeenLastCalledWith(latest.id);
  expect(screen.getByLabelText("体育台，观看记录")).toBeTruthy();
  await fireEvent.press(screen.getByRole("tab", { name: "收藏" }));
  expect(await screen.findByLabelText("取消收藏最新新闻台")).toBeTruthy();
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  expect(await screen.findByLabelText("最新新闻台，播放")).toBeTruthy();
  expect(repo.toggleFavorite).not.toHaveBeenCalled();
  expect(repo.deleteSource).not.toHaveBeenCalled();
});

test("a pending history deletion cannot remove a channel after leaving recent", async () => {
  setupRecentHistory();
  const savedRemove = repo.removeRecent.getMockImplementation()!;
  let finish!: () => void;
  repo.removeRecent.mockImplementationOnce(
    (id) =>
      new Promise<void>((resolve) => {
        finish = () => {
          void savedRemove(id).then(resolve);
        };
      }),
  );
  await render(<App />);
  await fireEvent.press(await screen.findByRole("tab", { name: "最近" }));
  await fireEvent.press(await screen.findByLabelText("管理观看记录"));
  await fireEvent.press(await screen.findByLabelText("删除体育台的观看记录"));
  expect(screen.getByLabelText("删除体育台的观看记录")).toBeDisabled();
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  await act(async () => finish());
  expect(await screen.findByLabelText("体育台，播放")).toBeTruthy();
  await fireEvent.press(screen.getByRole("tab", { name: "最近" }));
  await waitFor(() =>
    expect(screen.queryByLabelText("体育台，播放")).toBeNull(),
  );
  expect(screen.getByLabelText("最新新闻台，播放")).toBeTruthy();
});

test("clearing recent supports cancellation and failure retry while preserving favorites", async () => {
  setupRecentHistory();
  const alert = jest.spyOn(Alert, "alert");
  alert.mockImplementationOnce((_title, _message, buttons) =>
    buttons?.[0].onPress?.(),
  );
  await render(<App />);
  await fireEvent.press(await screen.findByRole("tab", { name: "最近" }));
  await fireEvent.press(await screen.findByLabelText("管理观看记录"));
  await fireEvent.press(screen.getByRole("button", { name: "清空最近观看" }));
  expect(repo.clearRecent).not.toHaveBeenCalled();
  expect(await screen.findByLabelText("最新新闻台，观看记录")).toBeTruthy();
  alert.mockImplementation((_title, _message, buttons) =>
    buttons?.[1].onPress?.(),
  );
  repo.clearRecent.mockRejectedValueOnce(new Error("disk failure"));
  await fireEvent.press(screen.getByRole("button", { name: "清空最近观看" }));
  await waitFor(() =>
    expect(screen.getByText("清空观看记录失败，请重试")).toBeTruthy(),
  );
  expect(screen.getByLabelText("最新新闻台，观看记录")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "清空最近观看" }));
  await waitFor(() => expect(screen.getByText("还没有观看记录")).toBeTruthy());
  await fireEvent.press(screen.getByRole("tab", { name: "收藏" }));
  expect(await screen.findByLabelText("最新新闻台，播放")).toBeTruthy();
  expect(screen.queryByText("继续观看")).toBeNull();
  alert.mockRestore();
});

test("history management clears the search, disables playback and returns to a clean read-only list", async () => {
  setupRecentHistory();
  await render(<App />);
  await fireEvent.press(await screen.findByRole("tab", { name: "最近" }));
  await fireEvent.changeText(
    screen.getByLabelText("搜索频道名称"),
    "不存在的历史",
  );
  await waitFor(() => expect(screen.getByText("没有找到频道")).toBeTruthy());
  await fireEvent.press(screen.getByLabelText("管理观看记录"));
  expect(screen.queryByLabelText("搜索频道名称")).toBeNull();
  const row = await screen.findByLabelText("最新新闻台，观看记录");
  expect(row).toBeDisabled();
  await fireEvent.press(row);
  expect(mockPlayerProps).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("取消收藏最新新闻台")).toBeNull();
  expect(screen.getByLabelText("删除旧频道的观看记录")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("完成历史管理"));
  expect(screen.getByLabelText("搜索频道名称").props.value).toBe("");
  expect(screen.getByLabelText("最新新闻台，播放")).toBeTruthy();
  expect(screen.queryByLabelText("删除最新新闻台的观看记录")).toBeNull();
  expect(screen.queryByLabelText("清空最近观看")).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "设置" }));
  expect(screen.queryByLabelText("清空最近观看")).toBeNull();
});

test("Android back exits history management before leaving the screen", async () => {
  setupRecentHistory();
  let back: (() => boolean | null | undefined) | undefined;
  const listener = jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation((_event, handler) => {
      back = () => handler({ type: "hardwareBackPress", timeStamp: 1 });
      return { remove: jest.fn() };
    });
  try {
    await render(<App />);
    await fireEvent.press(await screen.findByRole("tab", { name: "最近" }));
    await fireEvent.press(await screen.findByLabelText("管理观看记录"));
    expect(screen.getByLabelText("完成历史管理")).toBeTruthy();
    await act(() => expect(back?.()).toBe(true));
    expect(screen.getByLabelText("最新新闻台，播放")).toBeTruthy();
    expect(screen.queryByLabelText("删除最新新闻台的观看记录")).toBeNull();
    expect(back?.()).toBe(false);
    expect(
      screen.getByRole("tab", { name: "最近" }).props.accessibilityState
        .selected,
    ).toBe(true);
  } finally {
    listener.mockRestore();
  }
});
