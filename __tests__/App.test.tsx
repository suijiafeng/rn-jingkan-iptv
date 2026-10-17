import React from "react";
import { Alert } from "react-native";
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
jest.mock("../src/data/repository", () => ({ openRepository: jest.fn() }));
jest.mock("../src/data/importIO", () => ({
  downloadPlaylist: jest.fn(),
  readPickedFile: jest.fn(),
  ImportIOError: class extends Error {},
}));
jest.mock("../src/features/player/PlayerScreen", () => ({
  PlayerScreen: () => null,
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
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
};
beforeEach(() => {
  jest.clearAllMocks();
  repo.getSetting.mockImplementation(async (_k, fallback) => fallback);
  repo.listChannels.mockImplementation(async () => []);
  repo.listSources.mockImplementation(async () => []);
  repo.setSetting.mockImplementation(async () => {});
  repo.toggleFavorite.mockReset();
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
  await fireEvent.press(screen.getByText("最近"));
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
    await fireEvent.press(screen.getByText(destination, { exact: true }));
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
test("continue watching skips an unavailable latest channel", async () => {
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
  await waitFor(() =>
    expect(screen.getByText("上次看到 · 可用频道")).toBeTruthy(),
  );
  expect(screen.getByText("继续观看")).toBeTruthy();
  expect(screen.queryByText("上次看到 · 失效频道")).toBeNull();
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
