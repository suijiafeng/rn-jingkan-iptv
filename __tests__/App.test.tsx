import React from "react";
import {
  Alert,
  AppState,
  BackHandler,
  type AppStateStatus,
} from "react-native";
import * as Network from "expo-network";
import {
  fireEvent,
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import App from "../src/App";
import { openRepository } from "../src/data/repository";
import * as DocumentPicker from "expo-document-picker";
import { downloadPlaylist, readPickedFile } from "../src/data/importIO";
import { checkChannels } from "../src/features/source/availability";
jest.mock("../src/data/repository", () => ({ openRepository: jest.fn() }));
jest.mock("../src/data/importIO", () => ({
  downloadPlaylist: jest.fn(),
  readPickedFile: jest.fn(),
  ImportIOError: class extends Error {},
}));
const mockPlayerProps = jest.fn();
const mockManagerProps = jest.fn();
jest.mock("../src/features/source/SourceManagerModal", () => {
  const actual = jest.requireActual(
    "../src/features/source/SourceManagerModal",
  );
  return {
    ...actual,
    SourceManagerModal: (props: object) => {
      mockManagerProps(props);
      return <actual.SourceManagerModal {...props} />;
    },
  };
});
jest.mock("../src/features/player/PlayerScreen", () => ({
  PlayerScreen: (props: unknown) => {
    mockPlayerProps(props);
    return null;
  },
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("../src/features/source/availability", () => ({
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
}));
const repo = {
  getSetting: jest.fn(),
  listChannels: jest.fn(async () => []),
  listSources: jest.fn(async () => []),
  listGroups: jest.fn(async () => []),
  setSetting: jest.fn(async () => {}),
  importSource: jest.fn(async () => ({ id: "s" })),
  cancelRefresh: jest.fn(),
  toggleFavorite: jest.fn(),
  saveCheckResults: jest.fn(async () => {}),
  deleteSource: jest.fn(async () => {}),
  renameSource: jest.fn(async () => {}),
  removeRecent: jest.fn(async (_channelId: string) => {}),
  clearRecent: jest.fn(async () => {}),
  recordRecent: jest.fn(async (_channelId: string) => {}),
};
const checkSource = {
  id: "s1",
  name: "公开列表",
  kind: "url",
  location: "https://a.example.com/list.m3u",
  createdAt: 1,
  lastSuccessAt: 1,
  lastErrorCategory: null,
  revision: 1,
  channelCount: 2,
  favoriteCount: 0,
};
async function openSourceManager() {
  repo.listSources.mockImplementation(async () => [checkSource] as never[]);
  const ui = await render(<App />);
  await waitFor(() => expect(screen.getByText("设置")).toBeTruthy());
  await fireEvent.press(screen.getByText("设置"));
  await fireEvent.press(await screen.findByText("管理节目来源"));
  await waitFor(() => expect(screen.getByText("检测可用性")).toBeTruthy());
  return ui;
}
beforeEach(() => {
  jest.clearAllMocks();
  repo.getSetting.mockImplementation(async (_k, fallback) => fallback);
  repo.listChannels.mockImplementation(async () => []);
  repo.listSources.mockImplementation(async () => []);
  repo.listGroups.mockImplementation(async () => []);
  repo.setSetting.mockImplementation(async () => {});
  repo.toggleFavorite.mockReset();
  repo.deleteSource.mockReset().mockResolvedValue(undefined);
  repo.renameSource.mockReset().mockResolvedValue(undefined);
  repo.removeRecent.mockReset().mockResolvedValue(undefined);
  repo.clearRecent.mockReset().mockResolvedValue(undefined);
  repo.recordRecent.mockReset().mockResolvedValue(undefined);
  repo.saveCheckResults.mockReset().mockResolvedValue(undefined);
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
});
test("startup failure can retry opening local data without restarting", async () => {
  (openRepository as jest.Mock).mockRejectedValueOnce(new Error("unavailable"));
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("重新打开本地资料")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("重新打开本地资料"));
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  expect(openRepository).toHaveBeenCalledTimes(2);
});
test("loading does not invite users to import before local data has loaded", async () => {
  let finish!: (value: never[]) => void;
  repo.listSources.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<App />);
  await waitFor(() => expect(screen.getByText("正在读取频道…")).toBeTruthy());
  expect(screen.queryByText("从一份节目单开始")).toBeNull();
  await act(async () => finish([]));
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
});
test("failed list reads have a working retry", async () => {
  repo.listSources.mockRejectedValueOnce(new Error("read failed"));
  await render(<App />);
  await waitFor(() => expect(screen.getByText("重新读取频道")).toBeTruthy());
  expect(screen.queryByText("从一份节目单开始")).toBeNull();
  await fireEvent.press(screen.getByText("重新读取频道"));
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
});
test("an obsolete list failure cannot replace the current tab results", async () => {
  let fail!: (error: Error) => void;
  repo.listSources.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await render(<App />);
  await waitFor(() => expect(screen.getByText("正在读取频道…")).toBeTruthy());
  await fireEvent.press(screen.getByRole("tab", { name: "最近" }));
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await act(async () => fail(new Error("late failure")));
  expect(screen.queryByText("重新读取频道")).toBeNull();
});
test("settings permission write failures are shown without granting access", async () => {
  repo.setSetting.mockRejectedValueOnce(new Error("write failed"));
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) => buttons?.[1].onPress?.());
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("设置"));
  await fireEvent.press(screen.getByText("阅读风险并允许"));
  await waitFor(() =>
    expect(screen.getByText("无法保存网络许可，请重试")).toBeTruthy(),
  );
  expect(screen.getByText("未允许联网，频道资料仍可离线查看")).toBeTruthy();
  expect(downloadPlaylist).not.toHaveBeenCalled();
});
test("failed revocation stays blocked and can persist a retry without another consent prompt", async () => {
  let persistedAllowed = true;
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? persistedAllowed : fallback,
  );
  (repo.setSetting as jest.Mock).mockImplementation(async (key, value) => {
    if (key === "remoteAllowed") persistedAllowed = value;
  });
  repo.setSetting.mockRejectedValueOnce(new Error("disk unavailable"));
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) => buttons?.[1].onPress?.());
  const ui = await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("设置"));
  await fireEvent.press(screen.getByText("撤销联网许可"));
  await waitFor(() => expect(screen.getByText("重试保存撤销")).toBeTruthy());
  expect(persistedAllowed).toBe(true);
  expect(screen.queryByText("阅读风险并允许")).toBeNull();
  expect(
    screen.getByText(
      "联网已停止，撤销尚未保存。请重试保存，避免重启后恢复旧许可。",
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByText("重试保存撤销"));
  await waitFor(() => expect(screen.getByText("阅读风险并允许")).toBeTruthy());
  expect(alert).toHaveBeenCalledTimes(1);
  expect(persistedAllowed).toBe(false);
  expect(repo.setSetting.mock.calls).toEqual([
    ["remoteAllowed", false],
    ["remoteAllowed", false],
  ]);
  expect(
    screen.queryByText("许可已在本次运行中撤销，但未能保存。请重试撤销。"),
  ).toBeNull();
  await ui.unmount();
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("设置"));
  expect(screen.getByText("未允许联网，频道资料仍可离线查看")).toBeTruthy();
  expect(downloadPlaylist).not.toHaveBeenCalled();
});
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
  expect(screen.queryByTestId("channel-group-tabs")).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "最近" }));
  expect(await screen.findByLabelText("失效频道，来源已不再提供")).toBeTruthy();
  expect(screen.queryByLabelText("删除失效频道的观看记录")).toBeNull();
});
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
  (repo.listGroups as jest.Mock).mockResolvedValue(["新闻", "体育"]);
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByLabelText("频道甲，播放")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  await fireEvent.changeText(screen.getByLabelText("搜索频道名称"), "频道甲");
  await fireEvent.press(screen.getByRole("button", { name: "展开来源筛选" }));
  await fireEvent.press(screen.getByRole("button", { name: "来源甲" }));
  await fireEvent.press(screen.getByRole("button", { name: "体育" }));
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
async function openForm() {
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
test("initial empty UI offers import without any remote access", async () => {
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  expect(downloadPlaylist).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("设置"));
  expect(screen.getByText("联网与 HTTP 许可")).toBeTruthy();
});
test("declining informed consent never downloads the playlist", async () => {
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) => buttons?.[0].onPress?.());
  await openForm();
  await fireEvent.press(screen.getByText("解析并预览"));
  await waitFor(() => expect(screen.getByText("解析并预览")).toBeEnabled());
  expect(downloadPlaylist).not.toHaveBeenCalled();
  expect(repo.setSetting).not.toHaveBeenCalled();
});
test("invalid playlist preserves inputs and never writes the repository", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  (downloadPlaylist as jest.Mock).mockResolvedValue({
    text: "<html>bad</html>",
    url: "https://example.com/list.m3u",
  });
  await openForm();
  await fireEvent.press(screen.getByText("解析并预览"));
  await waitFor(() =>
    expect(screen.getByText("你的输入已保留。没有提前修改频道。")).toBeTruthy(),
  );
  expect(screen.getByDisplayValue("我的目录")).toBeTruthy();
  expect(screen.getByDisplayValue("https://example.com/list.m3u")).toBeTruthy();
  expect(repo.importSource).not.toHaveBeenCalled();
});
test("preview requires an explicit save before writing valid channels", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  (downloadPlaylist as jest.Mock).mockResolvedValue({
    text: "#EXTM3U\n#EXTINF:-1,山野\nhttps://example.com/live.m3u8",
    url: "https://example.com/list.m3u",
  });
  await openForm();
  await fireEvent.press(screen.getByText("解析并预览"));
  await waitFor(() =>
    expect(screen.getByText("确认保存 1 个频道")).toBeTruthy(),
  );
  expect(repo.importSource).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("确认保存 1 个频道"));
  await waitFor(() => expect(repo.importSource).toHaveBeenCalledTimes(1));
});
test("cancel aborts an in-flight import and a late result cannot save or reopen preview", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  let finish!: (value: { text: string; url: string }) => void;
  let signal: AbortSignal | undefined;
  (downloadPlaylist as jest.Mock).mockImplementation((_url, s) => {
    signal = s;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) => buttons?.[1].onPress?.());
  await openForm();
  await fireEvent.press(screen.getByText("解析并预览"));
  await waitFor(() => expect(downloadPlaylist).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByText("取消并返回"));
  await waitFor(() => expect(signal?.aborted).toBe(true));
  finish({
    text: "#EXTM3U\n#EXTINF:-1,晚到频道\nhttps://example.com/a.m3u8",
    url: "https://example.com/list.m3u",
  });
  await waitFor(() =>
    expect(screen.queryByText("确认保存 1 个频道")).toBeNull(),
  );
  expect(repo.importSource).not.toHaveBeenCalled();
});
test("URL preview cannot overwrite the previously selected local file content", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "cache://a", name: "自己的文件.m3u" }],
  });
  (readPickedFile as jest.Mock).mockResolvedValue(
    "#EXTM3U\n#EXTINF:-1,文件频道A\nhttps://example.com/a.m3u8",
  );
  (downloadPlaylist as jest.Mock).mockResolvedValue({
    text: "#EXTM3U\n#EXTINF:-1,网络频道B\nhttps://example.com/b.m3u8",
    url: "https://example.com/list.m3u",
  });
  await openForm();
  await fireEvent.press(screen.getByText("文件"));
  await fireEvent.press(screen.getByText("选择 / 更换文件"));
  await waitFor(() => expect(screen.getByText("自己的文件.m3u")).toBeTruthy());
  await fireEvent.press(screen.getByText("链接"));
  await fireEvent.press(screen.getByText("解析并预览"));
  await waitFor(() => expect(screen.getByText("网络频道B")).toBeTruthy());
  await fireEvent.press(screen.getByText("返回修改"));
  await fireEvent.press(screen.getByText("文件"));
  await fireEvent.press(screen.getByText("解析并预览"));
  await waitFor(() => expect(screen.getByText("文件频道A")).toBeTruthy());
  expect(screen.queryByText("网络频道B")).toBeNull();
  await fireEvent.press(screen.getByText("确认保存 1 个频道"));
  await waitFor(() =>
    expect(repo.importSource).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "file",
        content: expect.stringContaining("文件频道A"),
        location: "自己的文件.m3u",
      }),
    ),
  );
});

test("availability check never sends requests without network consent", async () => {
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) => buttons?.[0]?.onPress?.());
  await openSourceManager();
  await fireEvent.press(screen.getByText("检测可用性"));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  expect(checkChannels).not.toHaveBeenCalled();
  expect(repo.saveCheckResults).not.toHaveBeenCalled();
});

test("availability check shows progress, can be stopped, and saves finished results", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  const channels = [
    { id: "a", streamUrl: "https://a.example.com/a" },
    { id: "b", streamUrl: "https://a.example.com/b" },
  ];
  repo.listChannels.mockImplementation(async (q?: { sourceId?: string }) =>
    q?.sourceId ? (channels as never[]) : [],
  );
  let finish!: () => void;
  (checkChannels as jest.Mock).mockImplementation(
    (_targets, options: { signal: AbortSignal; onProgress: Function }) =>
      new Promise((resolve) => {
        options.onProgress(1, 2);
        finish = () =>
          resolve([
            { channelId: "a", streamUrl: "https://a.example.com/a", ok: true },
          ]);
        options.signal.addEventListener("abort", finish);
      }),
  );
  await openSourceManager();
  await fireEvent.press(screen.getByText("检测可用性"));
  await waitFor(() =>
    expect(screen.getByText("正在检测可用性 1/2")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("停止检测"));
  await waitFor(() =>
    expect(repo.saveCheckResults).toHaveBeenCalledWith([
      { channelId: "a", streamUrl: "https://a.example.com/a", ok: true },
    ]),
  );
  await waitFor(() =>
    expect(
      screen.getByText(/检测已停止。可访问 1 个，不可达 0 个/),
    ).toBeTruthy(),
  );
});

test.each(["revocation", "background", "stop", "unmount"])(
  "availability preflight cannot start requests after %s",
  async (action) => {
    repo.getSetting.mockImplementation(async (key, fallback) =>
      key === "remoteAllowed" ? true : fallback,
    );
    const listeners = new Set<(state: AppStateStatus) => void>();
    const subscription = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, listener) => {
        listeners.add(listener);
        return {
          remove: () => {
            listeners.delete(listener);
          },
        };
      });
    let finish!: (network: object) => void;
    (Network.getNetworkStateAsync as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    const ui = await openSourceManager();
    (repo.listChannels as jest.Mock).mockResolvedValue([
      { id: "a", streamUrl: "https://a.example.com/live" },
    ]);
    try {
      await fireEvent.press(screen.getByText("检测可用性"));
      await waitFor(() =>
        expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1),
      );
      if (action === "revocation") {
        await fireEvent.press(screen.getByText("返回", { exact: true }));
        await fireEvent.press(screen.getByText("撤销联网许可"));
        await waitFor(() =>
          expect(screen.getByText("阅读风险并允许")).toBeTruthy(),
        );
      } else if (action === "background") {
        await act(async () => {
          listeners.forEach((listener) => listener("background"));
          listeners.forEach((listener) => listener("active"));
        });
      } else if (action === "stop") {
        await fireEvent.press(screen.getByText("停止检测"));
      } else {
        await ui.unmount();
      }
      await act(async () => finish({ type: "WIFI", isConnected: true }));
      expect(checkChannels).not.toHaveBeenCalled();
      expect(repo.saveCheckResults).not.toHaveBeenCalled();
    } finally {
      subscription.mockRestore();
    }
  },
);

test("a stopped preflight cannot clear a replacement sweep", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  let finishPreflight!: (network: object) => void;
  (Network.getNetworkStateAsync as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPreflight = resolve;
      }),
  );
  (checkChannels as jest.Mock).mockImplementation(
    (_targets, options) =>
      new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve([]));
      }),
  );
  await openSourceManager();
  await fireEvent.press(screen.getByText("检测可用性"));
  await waitFor(() =>
    expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1),
  );
  await fireEvent.press(screen.getByText("停止检测"));
  await fireEvent.press(screen.getByText("检测可用性"));
  await waitFor(() => expect(checkChannels).toHaveBeenCalledTimes(1));
  await act(async () => finishPreflight({ type: "WIFI", isConnected: true }));
  expect(screen.getByText("停止检测")).toBeTruthy();
  expect(checkChannels).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText("停止检测"));
});

test("rapid check callbacks share a single preflight and sweep", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  let finish!: (network: object) => void;
  (Network.getNetworkStateAsync as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await openSourceManager();
  const start = mockManagerProps.mock.calls.at(-1)![0].onCheck;
  await act(async () => {
    start(checkSource);
    start(checkSource);
  });
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1);
  await act(async () => finish({ type: "WIFI", isConnected: true }));
  await waitFor(() => expect(checkChannels).toHaveBeenCalledTimes(1));
});

test("source-manager network failures are visible without closing the modal", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  (Network.getNetworkStateAsync as jest.Mock).mockResolvedValueOnce({
    type: "NONE",
    isConnected: false,
  });
  await openSourceManager();
  await fireEvent.press(screen.getByText("检测可用性"));
  await waitFor(() =>
    expect(screen.getByText("当前没有可用网络，请连接后重试")).toBeTruthy(),
  );
  expect(screen.getByRole("header", { name: "管理节目来源" })).toBeTruthy();
  expect(checkChannels).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("关闭提示"));
  expect(screen.queryByText("当前没有可用网络，请连接后重试")).toBeNull();
});

test("source deletion failure is shown inside source management", async () => {
  repo.deleteSource.mockRejectedValueOnce(new Error("disk unavailable"));
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
  await openSourceManager();
  await fireEvent.press(screen.getByText("删除", { exact: true }));
  await waitFor(() =>
    expect(screen.getByText("删除未完成，请重试")).toBeTruthy(),
  );
  expect(screen.getByRole("header", { name: "管理节目来源" })).toBeTruthy();
});

test("failed saving of finished results after a manual stop remains visible", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  repo.saveCheckResults.mockRejectedValueOnce(new Error("disk unavailable"));
  (checkChannels as jest.Mock).mockImplementation(
    (_targets, options) =>
      new Promise((resolve) => {
        options.signal.addEventListener("abort", () =>
          resolve([
            {
              channelId: "a",
              streamUrl: "https://a.example.com/live",
              ok: true,
            },
          ]),
        );
      }),
  );
  await openSourceManager();
  await fireEvent.press(screen.getByText("检测可用性"));
  await waitFor(() => expect(checkChannels).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByText("停止检测"));
  await waitFor(() =>
    expect(screen.getByText("检测结果未能保存，请重试")).toBeTruthy(),
  );
  expect(screen.getByRole("header", { name: "管理节目来源" })).toBeTruthy();
});

test("rename failure remains visible with the input and a working retry", async () => {
  repo.renameSource.mockRejectedValueOnce(new Error("disk unavailable"));
  await openSourceManager();
  await fireEvent.press(screen.getByText("改名", { exact: true }));
  await fireEvent.changeText(screen.getByLabelText("来源名称"), "新的名称");
  await fireEvent.press(screen.getByText("保存名称"));
  await waitFor(() => expect(screen.getByText("改名失败")).toBeTruthy());
  expect(screen.getByDisplayValue("新的名称")).toBeTruthy();
  await fireEvent.press(screen.getByText("保存名称"));
  await waitFor(() =>
    expect(screen.getByRole("header", { name: "管理节目来源" })).toBeTruthy(),
  );
  expect(screen.queryByText("改名失败")).toBeNull();
  expect(repo.renameSource).toHaveBeenCalledTimes(2);
});

test("playback receives the complete catalog when opened from favorites", async () => {
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
  expect(props.allChannels).toEqual([favorite, other]);
  await act(async () => props.onSelect(other, props.allChannels));
  const selected = mockPlayerProps.mock.calls.at(-1)![0];
  expect(selected.channel.id).toBe("other");
  expect(selected.channels).toEqual([favorite, other]);
});

function setupRecentHistory() {
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
  (repo.listGroups as jest.Mock).mockResolvedValue(["新闻", "体育"]);
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

test("navigation separates types from history and restores channel filters without hiding recent entries", async () => {
  setupRecentHistory();
  await render(<App />);
  expect(await screen.findByLabelText("最新新闻台，播放")).toBeTruthy();
  expect(screen.queryByTestId("channel-group-tabs")).toBeNull();
  await fireEvent.press(await screen.findByRole("tab", { name: "频道" }));
  await fireEvent.press(screen.getByRole("button", { name: "体育" }));
  await fireEvent.changeText(screen.getByLabelText("搜索频道名称"), "体育");
  expect(screen.queryByRole("button", { name: "最近" })).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "最近" }));
  await waitFor(() =>
    expect(screen.getByLabelText("旧频道，来源已不再提供")).toBeTruthy(),
  );
  expect(screen.getByLabelText("搜索频道名称").props.value).toBe("");
  expect(screen.getByLabelText("最新新闻台，播放")).toBeTruthy();
  expect(screen.getByLabelText("体育台，播放")).toBeTruthy();
  expect(screen.queryByTestId("channel-group-tabs")).toBeNull();
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
  expect(
    screen.getByRole("button", { name: "体育" }).props.accessibilityState
      .selected,
  ).toBe(true);
});

test("the all-type filter clears only the category while keeping the selected source", async () => {
  setupRecentHistory();
  await render(<App />);
  await fireEvent.press(await screen.findByRole("tab", { name: "频道" }));
  await fireEvent.press(
    await screen.findByRole("button", { name: "展开来源筛选" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "自己的来源" }));
  await fireEvent.press(screen.getByRole("button", { name: "体育" }));
  await waitFor(() =>
    expect(screen.queryByLabelText("最新新闻台，播放")).toBeNull(),
  );
  repo.listChannels.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "全部" }));
  expect(await screen.findByLabelText("最新新闻台，播放")).toBeTruthy();
  expect(screen.getByLabelText("体育台，播放")).toBeTruthy();
  expect(repo.listChannels).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "all",
      sourceId: "s1",
      groupName: undefined,
    }),
  );
  expect(
    screen.getByRole("button", { name: "全部" }).props.accessibilityState
      .selected,
  ).toBe(true);
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

test("player receives history for quick tuning without duplicate history-management callbacks", async () => {
  const { unavailable } = setupRecentHistory();
  await render(<App />);
  await fireEvent.press(await screen.findByLabelText("最新新闻台，播放"));
  await waitFor(() => expect(mockPlayerProps).toHaveBeenCalled());
  const player = mockPlayerProps.mock.calls.at(-1)![0];
  expect(
    player.recentChannels.map((item: { id: string }) => item.id),
  ).toContain(unavailable.id);
  expect(player.onRemoveRecent).toBeUndefined();
  expect(player.onClearRecent).toBeUndefined();
  expect(player.recentBusy).toBeUndefined();
  expect(repo.recordRecent).not.toHaveBeenCalled();
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
