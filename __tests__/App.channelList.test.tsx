import React from "react";
import {
  mockPlayerProps,
  repo,
  checkSource,
  rowsFor,
  chooseFacet,
  openFacetMenus,
  selectedContent,
  setupFacetCatalog,
  contentTabs,
  resetAppMocks,
} from "./support/appTestKit";
import { FlatList } from "react-native";
import {
  fireEvent,
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import App from "../src/App";
import * as Localization from "expo-localization";
import * as Location from "expo-location";

beforeEach(resetAppMocks);

test("clear search restores an unfiltered query", async () => {
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await fireEvent.changeText(screen.getByLabelText("搜索频道名称"), "测试频道");
  await waitFor(() =>
    expect(repo.listChannels).toHaveBeenCalledWith(
      expect.objectContaining({ search: "测试频道" }),
    ),
  );
  await fireEvent.press(screen.getByText("清除搜索"));
  expect(screen.getByLabelText("搜索频道名称").props.value).toBe("");
  await waitFor(() =>
    expect(repo.listChannels).toHaveBeenCalledWith(
      expect.objectContaining({ search: "" }),
    ),
  );
});

test("tabs remember independent search, source and group filters", async () => {
  const channel = {
    id: "c",
    name: "频道甲",
    active: true,
    favorite: true,
    sourceId: "s1",
    sourceName: "来源甲",
    groupName: "体育",
  };
  (repo.listChannels as jest.Mock).mockImplementation(async (query) =>
    query?.mode === "recent" ? [] : [channel],
  );
  (repo.listSources as jest.Mock).mockResolvedValue([
    { ...checkSource, name: "来源甲" },
    { ...checkSource, id: "s2", name: "来源乙" },
  ]);
  repo.listFacetRows.mockResolvedValue(
    rowsFor({
      countries: [],
      languages: [],
      contents: ["新闻", "体育"],
    }),
  );
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByLabelText("频道甲，播放")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  await fireEvent.changeText(screen.getByLabelText("搜索频道名称"), "频道甲");
  await fireEvent.press(screen.getByRole("button", { name: "展开来源筛选" }));
  await fireEvent.press(screen.getByRole("button", { name: "来源甲" }));
  await chooseFacet("内容", "体育");
  await waitFor(() =>
    expect(repo.listChannels).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "all",
        sourceId: "s1",
        groupName: "体育",
        search: "频道甲",
      }),
    ),
  );
  await fireEvent.press(screen.getByRole("tab", { name: "收藏" }));
  expect(screen.getByLabelText("搜索频道名称").props.value).toBe("");
  await fireEvent.changeText(
    screen.getByLabelText("搜索频道名称"),
    "收藏关键字",
  );
  repo.listChannels.mockClear();
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  expect(screen.getByLabelText("搜索频道名称").props.value).toBe("频道甲");
  await waitFor(() =>
    expect(repo.listChannels).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "all",
        sourceId: "s1",
        groupName: "体育",
        search: "频道甲",
      }),
    ),
  );
  await fireEvent.press(screen.getByRole("tab", { name: "收藏" }));
  expect(screen.getByLabelText("搜索频道名称").props.value).toBe("收藏关键字");
});
test("a long list shows its first page at once and still queues every row", async () => {
  const rows = Array.from({ length: 45 }, (_unused, index) => ({
    id: `c${index}`,
    name: `台${index}`,
    active: true,
    favorite: false,
    sourceId: "s",
    sourceName: "来源",
    groupName: "新闻",
  }));
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed"
      ? true
      : key === "countryPreference"
        ? {
            mode: "manual",
            countryCode: "CN",
            ipAllowed: false,
            locationAllowed: false,
          }
        : fallback,
  );
  repo.listFacetRows.mockResolvedValue(
    rowsFor({
      countries: ["CN", "US"],
      languages: ["zh"],
      contents: ["新闻"],
    }),
  );
  let finishRest!: () => void;
  const restReady = new Promise<void>((resolve) => (finishRest = resolve));
  (repo.listChannels as jest.Mock).mockImplementation(
    async (query?: { mode?: string; limit?: number; offset?: number }) => {
      if (query?.mode === "favorites" || query?.mode === "recent") return [];
      if (query?.offset) {
        await restReady;
        return rows.slice(query.offset);
      }
      return query?.limit ? rows.slice(0, query.limit) : rows;
    },
  );
  repo.countChannels.mockImplementation(async () => rows.length);
  await render(<App />);
  // The first page shows at once; every match is counted for the queue.
  await waitFor(() => expect(screen.getByLabelText("台0，播放")).toBeTruthy());
  expect(repo.listChannels).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "all", limit: 40, country: "CN" }),
  );
  expect(repo.countChannels).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "all", country: "CN" }),
  );
  // A tap before the remainder arrives waits for it to build the queue.
  await fireEvent.press(screen.getByLabelText("台0，播放"));
  await act(async () => finishRest());
  expect(repo.listChannels).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "all", offset: 40, country: "CN" }),
  );
  await waitFor(() => expect(mockPlayerProps).toHaveBeenCalled());
  const props = mockPlayerProps.mock.calls.at(-1)![0];
  expect(props.channel.id).toBe("c0");
  expect(props.channels.map((channel: { id: string }) => channel.id)).toEqual(
    rows.map((row) => row.id),
  );
});

test("the title and filters live in an overlay above the list, not inside it", async () => {
  (repo.listSources as jest.Mock).mockImplementation(async () => [
    { id: "s", name: "来源", channelCount: 1 },
  ]);
  (repo.listChannels as jest.Mock).mockImplementation(
    async (query?: { mode?: string }) =>
      query?.mode === "favorites" || query?.mode === "recent"
        ? []
        : [
            {
              id: "a",
              name: "甲台",
              active: true,
              favorite: false,
              sourceId: "s",
              sourceName: "来源",
              groupName: "新闻",
            },
          ],
  );
  await render(<App />);
  await screen.findByLabelText("甲台，播放");
  const list = screen.getByTestId("channel-list");
  // Not an in-list sticky row: on Android taps on such a row reached the
  // channel rows scrolled underneath it.
  expect(list.props.stickyHeaderIndices ?? []).toEqual([]);
  expect(list.props.data[0]).toMatchObject({ id: "a" });
  expect(list.props).toMatchObject({
    initialNumToRender: 12,
    maxToRenderPerBatch: 16,
    updateCellsBatchingPeriod: 16,
    windowSize: 21,
    removeClippedSubviews: false,
  });
  const overlay = screen.getByTestId("channel-header-overlay");
  expect(within(overlay).getByLabelText("搜索频道名称")).toBeTruthy();
});

test("country/language/content menus form an intersection and content tabs only list categories with channels", async () => {
  setupFacetCatalog();
  await render(<App />);
  await screen.findByLabelText("中文新闻，播放");
  expect(contentTabs()).toEqual(["全部", "体育", "新闻", "未分组"]);
  await chooseFacet("国家/地区", "中国大陆");
  await chooseFacet("语言", "英语");
  expect(await screen.findByLabelText("英语体育，播放")).toBeTruthy();
  expect(screen.queryByLabelText("美国英语，播放")).toBeNull();
  // 中国大陆 + 英语 has no news channel, so 新闻 is not offered.
  await waitFor(() => expect(contentTabs()).toEqual(["全部", "体育"]));
  await chooseFacet("内容", "体育");
  expect(await screen.findByLabelText("英语体育，播放")).toBeTruthy();
  expect(repo.listChannels).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "all",
      country: "CN",
      language: "en",
      groupName: "体育",
    }),
  );
  await chooseFacet("语言", "全部");
  expect(repo.listChannels).toHaveBeenCalledWith(
    expect.objectContaining({
      country: "CN",
      language: undefined,
      groupName: "体育",
    }),
  );
  expect(
    screen.getByRole("button", { name: "国家/地区：中国大陆" }),
  ).toBeTruthy();
  expect(selectedContent()).toBe("体育");
});

test("unlabelled facet values reach SQLite queries as empty strings instead of all", async () => {
  setupFacetCatalog();
  await render(<App />);
  await screen.findByLabelText("未知频道，播放");
  await chooseFacet("国家/地区", "未标注");
  await chooseFacet("语言", "未标注");
  await chooseFacet("内容", "未标注");
  expect(await screen.findByLabelText("未知频道，播放")).toBeTruthy();
  expect(screen.queryByLabelText("中文新闻，播放")).toBeNull();
  expect(repo.listChannels).toHaveBeenCalledWith(
    expect.objectContaining({ country: "", language: "", groupName: "" }),
  );
});

test("manual country all persists over a matching device recommendation and app reopening", async () => {
  setupFacetCatalog();
  (Localization.getLocales as jest.Mock).mockReturnValue([
    { regionCode: "CN", languageCode: "zh" },
  ]);
  (Localization.getCalendars as jest.Mock).mockReturnValue([
    { timeZone: "Asia/Shanghai" },
  ]);
  let preference: unknown;
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "countryPreference" && preference ? preference : fallback,
  );
  (repo.setSetting as jest.Mock).mockImplementation(async (key, value) => {
    if (key === "countryPreference") preference = value;
  });
  const ui = await render(<App />);
  await screen.findByLabelText("中文新闻，播放");
  expect(screen.queryByLabelText("美国中文，播放")).toBeNull();
  await chooseFacet("国家/地区", "全部");
  expect(await screen.findByLabelText("美国中文，播放")).toBeTruthy();
  expect(preference).toEqual({
    mode: "manual",
    countryCode: null,
    ipAllowed: false,
    locationAllowed: false,
  });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await ui.unmount();
  await render(<App />);
  expect(await screen.findByLabelText("美国中文，播放")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /^清除国家\/地区筛选/ }),
  ).toBeNull();
  await openFacetMenus();
  expect(screen.getByRole("button", { name: "国家/地区：全部" })).toBeTruthy();
});

test("a deep scroll offset is restored once the reloaded list is tall enough", async () => {
  const rows = Array.from({ length: 30 }, (_unused, index) => ({
    id: `c${index}`,
    name: `台${index}`,
    active: true,
    favorite: false,
    sourceId: "s",
    sourceName: "来源",
    groupName: "新闻",
  }));
  (repo.listChannels as jest.Mock).mockImplementation(async (query) =>
    query?.mode === "favorites" || query?.mode === "recent" ? [] : rows,
  );
  const scrollToOffset = jest
    .spyOn(FlatList.prototype, "scrollToOffset")
    .mockImplementation(() => {});
  try {
    await render(<App />);
    expect(await screen.findByLabelText("台0，播放")).toBeTruthy();
    const list = () => screen.getByTestId("channel-list");
    const scrollEvent = (offsetY: number) => ({
      nativeEvent: {
        contentOffset: { x: 0, y: offsetY },
        contentSize: { width: 400, height: 100_000 },
        layoutMeasurement: { width: 400, height: 800 },
      },
    });
    // The list reports where it is; a drag that settles saves the offset.
    const scroll = async (offsetY: number) =>
      fireEvent.scroll(list(), scrollEvent(offsetY));
    const dragTo = async (offsetY: number) => {
      await scroll(offsetY);
      await fireEvent(list(), "scrollEndDrag", scrollEvent(offsetY));
    };
    await dragTo(90_000);
    await fireEvent.press(screen.getByText("收藏", { exact: true }));
    expect(await screen.findByText("从一份节目单开始")).toBeTruthy();
    scrollToOffset.mockClear();
    await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
    expect(await screen.findByLabelText("台0，播放")).toBeTruthy();
    await waitFor(() =>
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: 90_000,
        animated: false,
      }),
    );
    // The list is still short, so Android clamps the scroll and reports 700;
    // the request is re-sent on later frames and 700 is never saved, not
    // even by a drag that settles there.
    await dragTo(700);
    await waitFor(() =>
      expect(scrollToOffset.mock.calls.length).toBeGreaterThanOrEqual(3),
    );
    for (const [arg] of scrollToOffset.mock.calls)
      expect(arg).toEqual({ offset: 90_000, animated: false });
    await scroll(90_000);
    // Reaching the target stops the retries.
    const sent = scrollToOffset.mock.calls.length;
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(scrollToOffset).toHaveBeenCalledTimes(sent);
    // The clamped 700 was never saved: leaving and returning targets 90000.
    await fireEvent.press(screen.getByText("收藏", { exact: true }));
    expect(await screen.findByText("从一份节目单开始")).toBeTruthy();
    scrollToOffset.mockClear();
    await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
    await waitFor(() =>
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: 90_000,
        animated: false,
      }),
    );
  } finally {
    scrollToOffset.mockRestore();
  }
});
