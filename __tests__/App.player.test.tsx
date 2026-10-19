import React from "react";
import {
  mockPlayerProps,
  repo,
  checkSource,
  chooseFacet,
  setupRecentHistory,
  setupFacetCatalog,
  resetAppMocks,
} from "./support/appTestKit";
import { BackHandler, StyleSheet } from "react-native";
import {
  fireEvent,
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import App from "../src/App";
import type { Channel, ChannelQuery } from "../src/domain/types";

beforeEach(resetAppMocks);

test("the sheet shows the page's list, and switching its tab switches the page", async () => {
  const favorite = {
    id: "fav",
    name: "收藏台",
    active: true,
    favorite: true,
    sourceId: "s",
    sourceName: "来源",
    groupName: "新闻",
  };
  const other = { ...favorite, id: "other", name: "其他台", favorite: false };
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  (repo.listChannels as jest.Mock).mockImplementation(async (query) =>
    query?.mode === "favorites"
      ? [favorite]
      : query?.mode === "recent"
        ? []
        : [favorite, other],
  );
  await render(<App />);
  await fireEvent.press(await screen.findByLabelText("收藏台，播放"));
  await waitFor(() => expect(mockPlayerProps).toHaveBeenCalled());
  const props = mockPlayerProps.mock.calls.at(-1)![0];
  expect(props.channels).toEqual([favorite]);
  expect(props.sheet.filters.tab).toBe("favorites");
  expect(props.sheet.channels).toEqual([favorite]);
  await act(async () => props.sheet.onTabChange("all"));
  await waitFor(() =>
    expect(mockPlayerProps.mock.calls.at(-1)![0].sheet.channels).toEqual([
      favorite,
      other,
    ]),
  );
  const sheet = mockPlayerProps.mock.calls.at(-1)![0].sheet;
  expect(sheet.filters.tab).toBe("all");
  expect(sheet.rangeKey).not.toBeNull();
  await act(async () =>
    mockPlayerProps.mock.calls.at(-1)![0].onSelect(other, sheet.channels),
  );
  const selected = mockPlayerProps.mock.calls.at(-1)![0];
  expect(selected.channel.id).toBe("other");
  expect(selected.channels).toEqual([favorite, other]);
  // The whole catalog is never read for the sheet.
  // The sheet reads no catalog of its own: every list read is a page query
  // (the empty call is this file's getChannel mock).
  expect(
    (repo.listChannels as jest.Mock).mock.calls.filter(
      ([query]) => query && !query.mode,
    ),
  ).toEqual([]);
  await act(async () => selected.onClose());
  expect(
    screen.getByRole("tab", { name: "频道" }).props.accessibilityState.selected,
  ).toBe(true);
});

test("the sheet's recent tab is the page's history without history-management actions", async () => {
  const { unavailable } = setupRecentHistory();
  await render(<App />);
  await fireEvent.press(await screen.findByLabelText("最新新闻台，播放"));
  await waitFor(() => expect(mockPlayerProps).toHaveBeenCalled());
  const player = mockPlayerProps.mock.calls.at(-1)![0];
  await act(async () => player.sheet.onTabChange("recent"));
  await waitFor(() =>
    expect(
      mockPlayerProps.mock.calls
        .at(-1)![0]
        .sheet.channels.map((item: { id: string }) => item.id),
    ).toContain(unavailable.id),
  );
  const latest = mockPlayerProps.mock.calls.at(-1)![0];
  expect(latest.sheet.filters.recentEditing).toBe(false);
  expect(latest.onRemoveRecent).toBeUndefined();
  expect(latest.onClearRecent).toBeUndefined();
  expect(repo.recordRecent).not.toHaveBeenCalled();
});

test("filters chosen in the sheet are the channel page's filters", async () => {
  setupFacetCatalog();
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  await render(<App />);
  await fireEvent.press(await screen.findByLabelText("中文新闻，播放"));
  await waitFor(() => expect(mockPlayerProps).toHaveBeenCalled());
  const { sheet } = mockPlayerProps.mock.calls.at(-1)![0];
  await act(async () =>
    sheet.filters.onFacetChange(
      { ...sheet.filters.facetSelection, language: "en" },
      "language",
    ),
  );
  await waitFor(() =>
    expect(
      mockPlayerProps.mock.calls
        .at(-1)![0]
        .sheet.channels.map((channel: Channel) => channel.name),
    ).toEqual(["英语体育", "美国英语"]),
  );
  await act(async () =>
    mockPlayerProps.mock.calls.at(-1)![0].sheet.filters.onSearchChange("美国"),
  );
  await act(async () => mockPlayerProps.mock.calls.at(-1)![0].onClose());
  expect(
    screen.getByRole("button", { name: "清除语言筛选：英语" }),
  ).toBeTruthy();
  expect(screen.getByLabelText("搜索频道名称").props.value).toBe("美国");
  // Search settles after the page's usual 250 ms debounce.
  await waitFor(() => {
    expect(screen.getByLabelText("美国英语，播放")).toBeTruthy();
    expect(screen.queryByLabelText("英语体育，播放")).toBeNull();
  });
});

test("locating from the sheet shows every country without changing the saved choice", async () => {
  setupFacetCatalog();
  let preference: unknown;
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed"
      ? true
      : key === "countryPreference" && preference
        ? preference
        : fallback,
  );
  (repo.setSetting as jest.Mock).mockImplementation(async (key, value) => {
    if (key === "countryPreference") preference = value;
  });
  await render(<App />);
  await chooseFacet("国家/地区", "美国");
  await fireEvent.press(await screen.findByLabelText("美国中文，播放"));
  await waitFor(() => expect(mockPlayerProps).toHaveBeenCalled());
  const saved = preference;
  await act(async () => mockPlayerProps.mock.calls.at(-1)![0].sheet.onLocate());
  await waitFor(() =>
    expect(
      mockPlayerProps.mock.calls
        .at(-1)![0]
        .sheet.channels.map((channel: Channel) => channel.name),
    ).toContain("中文新闻"),
  );
  expect(
    mockPlayerProps.mock.calls.at(-1)![0].sheet.filters.facetSelection.country,
  ).toBeNull();
  expect(preference).toBe(saved);
  // Choosing a country again ends the bypass.
  await act(async () => {
    const { filters } = mockPlayerProps.mock.calls.at(-1)![0].sheet;
    filters.onFacetChange(
      { ...filters.facetSelection, country: "US" },
      "country",
    );
  });
  await waitFor(() =>
    expect(
      mockPlayerProps.mock.calls
        .at(-1)![0]
        .sheet.channels.map((channel: Channel) => channel.name),
    ).not.toContain("中文新闻"),
  );
});

test("the docked player bar leaves the page usable and yields the back key to dialogs", async () => {
  const channel = {
    id: "cctv1",
    groupKey: "iptv:cctv1.cn",
    name: "CCTV-1",
    active: true,
    favorite: false,
    sourceId: "s1",
    sourceName: "来源一",
    groupName: "新闻",
  };
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  repo.listSources.mockResolvedValue([
    { ...checkSource, id: "s1", name: "来源一" },
  ] as never[]);
  (repo.listChannels as jest.Mock).mockImplementation(
    async (query?: ChannelQuery) =>
      query?.mode === "recent" ? [] : ([channel] as never[]),
  );
  repo.getChannel.mockImplementation(async (id) =>
    id === channel.id ? channel : null,
  );
  (repo.listChannelSources as jest.Mock).mockImplementation(async () => [
    channel,
  ]);
  let back: (() => boolean | null | undefined) | undefined;
  const listener = jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation((_event, handler) => {
      back = () => handler({ type: "hardwareBackPress", timeStamp: 1 });
      return { remove: jest.fn() };
    });
  try {
    await render(<App />);
    await fireEvent.press(await screen.findByLabelText("CCTV-1，播放"));
    await waitFor(() => expect(mockPlayerProps).toHaveBeenCalled());
    let player = mockPlayerProps.mock.calls.at(-1)![0];
    expect(player.mini).toBe(false);
    // Expanded: the page is hidden from TalkBack and the key is the player's.
    expect(screen.queryByTestId("channel-list")).toBeNull();
    expect(back?.()).toBe(false);
    await act(() => player.onMinimize());
    await waitFor(() =>
      expect(mockPlayerProps.mock.calls.at(-1)![0].mini).toBe(true),
    );
    // Docked: the page is reachable again.
    expect(screen.getByTestId("channel-list")).toBeTruthy();
    expect(
      StyleSheet.flatten(screen.getByTestId("player-container").props.style),
    ).toMatchObject({ left: 8, right: 8 });
    // Docked: the page's own dialog takes the key first…
    await fireEvent.press(screen.getByRole("tab", { name: "设置" }));
    await fireEvent.press(screen.getByText("管理节目来源"));
    await act(() => expect(back?.()).toBe(true));
    // …and with nothing open the key goes to the player (which stops).
    await act(() => expect(back?.()).toBe(false));
    player = mockPlayerProps.mock.calls.at(-1)![0];
    await act(() => player.onExpand());
    expect(mockPlayerProps.mock.calls.at(-1)![0].mini).toBe(false);
    // Picking a channel from the page while docked opens the full player.
    await act(() => mockPlayerProps.mock.calls.at(-1)![0].onMinimize());
    await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
    await fireEvent.press(await screen.findByLabelText("CCTV-1，播放"));
    await waitFor(() =>
      expect(mockPlayerProps.mock.calls.at(-1)![0].mini).toBe(false),
    );
  } finally {
    listener.mockRestore();
  }
});
