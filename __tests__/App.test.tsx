import React from "react";
import { Alert } from "react-native";
import {
  fireEvent,
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
};
beforeEach(() => {
  jest.clearAllMocks();
  repo.getSetting.mockImplementation(async (_k, fallback) => fallback);
  (openRepository as jest.Mock).mockResolvedValue(repo);
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
