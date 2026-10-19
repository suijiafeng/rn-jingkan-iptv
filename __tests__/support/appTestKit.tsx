/**
 * Shared mocks, fixtures and helpers for the App test files.
 *
 * Import this module before `../src/App` (or anything that requires it):
 * babel-jest hoists the jest.mock calls below to the top of this module, so
 * they are registered before App and its dependencies are first required.
 * Each test file must call `beforeEach(resetAppMocks)`.
 */
import React from "react";
import { hideToast } from "../../src/components/Toast";
import { AppState } from "react-native";
import * as Network from "expo-network";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import * as Localization from "expo-localization";
import App from "../../src/App";
import { openRepository } from "../../src/data/repository";
import { checkChannels } from "../../src/features/source/availability";
import {
  matchesChannelFacets,
  type ChannelFacetOptions,
  type FacetChannel,
} from "../../src/domain/channelFacets";
import type { Channel, ChannelQuery } from "../../src/domain/types";
jest.mock("../../src/data/repository", () => ({ openRepository: jest.fn() }));
jest.mock("../../src/data/importIO", () => ({
  downloadPlaylist: jest.fn(),
  readPickedFile: jest.fn(),
  ImportIOError: class extends Error {},
}));
export const mockPlayerProps = jest.fn();
export const mockManagerProps = jest.fn();
jest.mock("../../src/features/source/SourceManagerModal", () => {
  const actual = jest.requireActual(
    "../../src/features/source/SourceManagerModal",
  );
  return {
    ...actual,
    SourceManagerModal: (props: object) => {
      mockManagerProps(props);
      return <actual.SourceManagerModal {...props} />;
    },
  };
});
jest.mock("../../src/features/player/PlayerScreen", () => ({
  PlayerScreen: (props: unknown) => {
    mockPlayerProps(props);
    return null;
  },
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ regionCode: null, languageCode: "zh" }]),
  getCalendars: jest.fn(() => [{ timeZone: "UTC" }]),
}));
jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({
    status: "undetermined",
  })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: "denied",
  })),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock("../../src/features/source/availability", () => ({
  checkChannels: jest.fn(),
}));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: jest.fn(async () => ({
    isConnected: true,
    type: "WIFI",
  })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  NetworkStateType: { CELLULAR: "CELLULAR" },
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: jest.requireActual("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
/** Facet rows that yield exactly these content tabs. */
export function rowsFor(options: ChannelFacetOptions): FacetChannel[] {
  return options.contents.map((groupName) => ({
    countries: options.countries,
    languages: options.languages,
    groupName,
  }));
}
export const repo = {
  getSetting: jest.fn(),
  listChannels: jest.fn(async () => []),
  countChannels: jest.fn(async () => 0),
  listSources: jest.fn(async () => []),
  listFacetRows: jest.fn(async (): Promise<FacetChannel[]> => []),
  setSetting: jest.fn(async () => {}),
  importSource: jest.fn(async () => ({ id: "s" })),
  cancelRefresh: jest.fn(),
  toggleFavorite: jest.fn(),
  saveCheckResults: jest.fn(async () => {}),
  getCheckResults: jest.fn(async () => []),
  // Playback reads just the chosen channel; derive it from the list mock.
  getChannel: jest.fn(
    async (id: string): Promise<unknown> =>
      ((await listChannelsForLookup()) as { id: string }[]).find(
        (channel) => channel.id === id,
      ) ?? null,
  ),
  listChannelSources: jest.fn(async (_groupKey: string) => []),
  deleteSource: jest.fn(async () => {}),
  setSourceEnabled: jest.fn(async () => {}),
  renameSource: jest.fn(async () => {}),
  removeRecent: jest.fn(async (_channelId: string) => {}),
  clearRecent: jest.fn(async () => {}),
  recordRecent: jest.fn(async (_channelId: string) => {}),
  clearAll: jest.fn(async () => {}),
};
export const checkSource = {
  id: "s1",
  name: "公开列表",
  kind: "url",
  enabled: true,
  location: "https://a.example.com/list.m3u",
  createdAt: 1,
  lastSuccessAt: 1,
  lastErrorCategory: null,
  revision: 1,
  channelCount: 2,
  favoriteCount: 0,
};
export async function openSourceManager() {
  repo.listSources.mockImplementation(async () => [checkSource] as never[]);
  const ui = await render(<App />);
  await waitFor(() => expect(screen.getByText("设置")).toBeTruthy());
  await fireEvent.press(screen.getByText("设置"));
  await fireEvent.press(await screen.findByText("管理节目来源"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "检测可用性" })).toBeTruthy(),
  );
  return ui;
}
function listChannelsForLookup(): Promise<unknown> {
  return (repo.listChannels as jest.Mock)();
}
/** Per-test reset; every App test file registers it with beforeEach. */
export function resetAppMocks() {
  jest.clearAllMocks();
  hideToast();
  // Only the first-run guide test sees the guide over the home screen.
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "guideSeen" ? true : fallback,
  );
  repo.listChannels.mockImplementation(async () => []);
  repo.countChannels.mockImplementation(async () => 0);
  repo.listSources.mockImplementation(async () => []);
  repo.listFacetRows.mockImplementation(async () => []);
  repo.getChannel.mockImplementation(
    async (id: string): Promise<unknown> =>
      ((await listChannelsForLookup()) as { id: string }[]).find(
        (channel) => channel.id === id,
      ) ?? null,
  );
  repo.listChannelSources.mockReset().mockResolvedValue([]);
  repo.clearAll.mockReset().mockResolvedValue(undefined);
  repo.setSetting.mockImplementation(async () => {});
  repo.toggleFavorite.mockReset();
  repo.deleteSource.mockReset().mockResolvedValue(undefined);
  repo.setSourceEnabled.mockReset().mockResolvedValue(undefined);
  repo.renameSource.mockReset().mockResolvedValue(undefined);
  repo.removeRecent.mockReset().mockResolvedValue(undefined);
  repo.clearRecent.mockReset().mockResolvedValue(undefined);
  repo.recordRecent.mockReset().mockResolvedValue(undefined);
  repo.saveCheckResults.mockReset().mockResolvedValue(undefined);
  repo.getCheckResults.mockReset().mockResolvedValue([]);
  (Localization.getLocales as jest.Mock).mockReturnValue([
    { regionCode: null, languageCode: "zh" },
  ]);
  (Localization.getCalendars as jest.Mock).mockReturnValue([
    { timeZone: "UTC" },
  ]);
  (checkChannels as jest.Mock).mockReset().mockResolvedValue([]);
  (Network.getNetworkStateAsync as jest.Mock)
    .mockReset()
    .mockResolvedValue({ type: "WIFI", isConnected: true });
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    writable: true,
    value: "active",
  });
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(() => ({ remove: jest.fn() }));
  (openRepository as jest.Mock).mockResolvedValue(repo);
}

export async function chooseFacet(
  kind: "国家/地区" | "语言" | "内容",
  option: string,
) {
  if (kind === "内容") {
    // Content is a row of one-tap tabs; unlabeled shows as 未分组.
    const tabs = await screen.findByTestId(
      "channel-facet-filters-content-tabs",
    );
    await fireEvent.press(
      within(tabs).getByRole("button", {
        name: option === "未标注" ? "未分组" : option,
      }),
    );
    return;
  }
  await openFacetMenus();
  await fireEvent.press(
    await screen.findByRole("button", { name: new RegExp(`^${kind}：`) }),
  );
  const menu = await screen.findByTestId("channel-facet-filters-modal");
  await fireEvent.press(within(menu).getByRole("button", { name: option }));
}
/** Unfolds the country/language menus behind the channel page's filter icon. */
export async function openFacetMenus() {
  const toggle = screen.queryByRole("button", {
    name: "按国家/地区或语言筛选",
  });
  if (toggle && !toggle.props.accessibilityState?.expanded)
    await fireEvent.press(toggle);
}
export function selectedContent(): string | undefined {
  const tabs = screen.getByTestId("channel-facet-filters-content-tabs");
  return within(tabs)
    .getAllByRole("button")
    .find((tab) => tab.props.accessibilityState?.selected)?.props
    .accessibilityLabel;
}

export async function openForm() {
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("添加节目单"));
  await fireEvent.changeText(screen.getByLabelText("来源名称"), "我的目录");
  await fireEvent.changeText(
    screen.getByLabelText("节目单链接"),
    "https://example.com/list.m3u",
  );
}

export function setupRecentHistory() {
  const latest = {
    id: "latest",
    name: "最新新闻台",
    active: true,
    favorite: true,
    sourceId: "s1",
    sourceName: "自己的来源",
    groupName: "新闻",
    lastPlayedAt: 30,
  };
  const earlier = {
    ...latest,
    id: "earlier",
    name: "体育台",
    favorite: false,
    groupName: "体育",
    lastPlayedAt: 20,
  };
  const unavailable = {
    ...latest,
    id: "unavailable",
    name: "旧频道",
    active: false,
    favorite: false,
    lastPlayedAt: 10,
  };
  const catalog = [latest, earlier, unavailable];
  let history = [...catalog];
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  (repo.listSources as jest.Mock).mockResolvedValue([
    { ...checkSource, name: "自己的来源" },
    { ...checkSource, id: "s2", name: "其他来源" },
  ]);
  repo.listFacetRows.mockResolvedValue(
    rowsFor({
      countries: [],
      languages: [],
      contents: ["新闻", "体育"],
    }),
  );
  (repo.listChannels as jest.Mock).mockImplementation(async (query) => {
    const items =
      query?.mode === "recent"
        ? history
        : query?.mode === "favorites"
          ? catalog.filter((item) => item.favorite)
          : catalog.filter((item) => item.active);
    return items
      .filter(
        (item) =>
          (!query?.groupName || item.groupName === query.groupName) &&
          (!query?.sourceId || item.sourceId === query.sourceId) &&
          (!query?.search || item.name.includes(query.search)),
      )
      .map((item) => ({
        ...item,
        lastPlayedAt: history.some((entry) => entry.id === item.id)
          ? item.lastPlayedAt
          : null,
      }));
  });
  repo.removeRecent.mockImplementation(async (id) => {
    history = history.filter((item) => item.id !== id);
  });
  repo.clearRecent.mockImplementation(async () => {
    history = [];
  });
  return { latest, earlier, unavailable };
}

export function setupFacetCatalog() {
  const base = {
    sourceId: "s1",
    sourceName: "维度来源",
    active: true,
    favorite: false,
    logoUrl: "https://images.example.com/logo.png",
    groupName: "新闻",
    countries: ["CN"],
    languages: ["zh"],
  };
  const catalog = [
    { ...base, id: "cn-zh", name: "中文新闻" },
    {
      ...base,
      id: "cn-en",
      name: "英语体育",
      languages: ["en"],
      groupName: "体育",
    },
    { ...base, id: "us-zh", name: "美国中文", countries: ["US"] },
    {
      ...base,
      id: "us-en",
      name: "美国英语",
      countries: ["US"],
      languages: ["en"],
    },
    {
      ...base,
      id: "unknown",
      name: "未知频道",
      countries: [],
      languages: [],
      groupName: "未分组",
    },
  ] as Channel[];
  repo.listSources.mockResolvedValue([
    { ...checkSource, name: "维度来源" },
  ] as never[]);
  (repo.listFacetRows as jest.Mock).mockImplementation(
    async (sourceId?: string) =>
      catalog.filter((channel) => !sourceId || channel.sourceId === sourceId),
  );
  (repo.listChannels as jest.Mock).mockImplementation(
    async (query: ChannelQuery = {}) => {
      if (query.mode === "favorites" || query.mode === "recent") return [];
      return catalog.filter(
        (channel) =>
          (!query.sourceId || query.sourceId === channel.sourceId) &&
          (!query.search || channel.name.includes(query.search)) &&
          matchesChannelFacets(channel, {
            country: query.country ?? null,
            language: query.language ?? null,
            content: query.groupName ?? null,
          }),
      );
    },
  );
  return catalog;
}

export function contentTabs(): string[] {
  const tabs = screen.getByTestId("channel-facet-filters-content-tabs");
  return within(tabs)
    .getAllByRole("button")
    .map((tab) => tab.props.accessibilityLabel);
}
