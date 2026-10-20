import React from "react";
import { repo, openForm, resetAppMocks } from "./support/appTestKit";
import { Alert } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import App from "../src/App";
import * as DocumentPicker from "expo-document-picker";
import { downloadPlaylist, readPickedFile } from "../src/data/importIO";
import * as Network from "expo-network";

beforeEach(resetAppMocks);

test("initial empty UI offers import without any remote access", async () => {
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  expect(downloadPlaylist).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("设置"));
  expect(screen.getByText("节目来源联网")).toBeTruthy();
});
test("declining informed consent never downloads the playlist", async () => {
  await openForm();
  await fireEvent.press(screen.getByText("预览"));
  await fireEvent.press(await screen.findByRole("button", { name: "不用了" }));
  await waitFor(() => expect(screen.getByText("预览")).toBeEnabled());
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
  await fireEvent.press(screen.getByText("预览"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
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
  await fireEvent.press(screen.getByText("预览"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "导入 1 个频道" })).toBeTruthy(),
  );
  expect(repo.importSource).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "导入 1 个频道" }));
  await waitFor(() => expect(repo.importSource).toHaveBeenCalledTimes(1));
});
test("back from preview returns to editing; back again asks before discarding", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  (downloadPlaylist as jest.Mock).mockResolvedValue({
    text: "#EXTM3U\n#EXTINF:-1,山野\nhttps://example.com/live.m3u8",
    url: "https://example.com/list.m3u",
  });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await openForm();
  await fireEvent.press(screen.getByText("预览"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "导入 1 个频道" })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole("button", { name: "返回" }));
  // One level only: the inputs are back, nothing was asked or discarded.
  expect(screen.getByDisplayValue("https://example.com/list.m3u")).toBeTruthy();
  expect(alert).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "返回" }));
  expect(alert).toHaveBeenCalledWith(
    "放弃这次导入？",
    expect.any(String),
    expect.any(Array),
    expect.anything(),
  );
  expect(repo.importSource).not.toHaveBeenCalled();
});
test("cancel aborts an in-flight import and a late result cannot save or reopen preview", async () => {
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  let finish!: (value: { text: string; url: string }) => void;
  let signal: AbortSignal | undefined;
  (downloadPlaylist as jest.Mock).mockImplementation((_url, abortSignal) => {
    signal = abortSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[1].onPress?.(),
    );
  await openForm();
  await fireEvent.press(screen.getByText("预览"));
  await waitFor(() => expect(downloadPlaylist).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByRole("button", { name: "返回" }));
  await waitFor(() => expect(signal?.aborted).toBe(true));
  finish({
    text: "#EXTM3U\n#EXTINF:-1,晚到频道\nhttps://example.com/a.m3u8",
    url: "https://example.com/list.m3u",
  });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "导入 1 个频道" })).toBeNull(),
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
  // Switching to 文件 opens the picker by itself.
  await fireEvent.press(screen.getByText("文件"));
  await waitFor(() => expect(screen.getByText("自己的文件.m3u")).toBeTruthy());
  await fireEvent.press(screen.getByText("链接"));
  await fireEvent.press(screen.getByText("预览"));
  await waitFor(() => expect(screen.getByText("网络频道B")).toBeTruthy());
  await fireEvent.press(screen.getByText("返回修改"));
  await fireEvent.press(screen.getByText("文件"));
  await fireEvent.press(screen.getByText("预览"));
  await waitFor(() => expect(screen.getByText("文件频道A")).toBeTruthy());
  expect(screen.queryByText("网络频道B")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "导入 1 个频道" }));
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
test("a first import on mobile data asks once: consent covers the data warning", async () => {
  (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({
    type: "CELLULAR",
    isConnected: true,
  });
  (downloadPlaylist as jest.Mock).mockResolvedValue({
    text: "#EXTM3U\n#EXTINF:-1,山野\nhttps://example.com/live.m3u8",
    url: "https://example.com/list.m3u",
  });
  const alert = jest.spyOn(Alert, "alert");
  await openForm();
  await fireEvent.press(screen.getByText("预览"));
  expect(await screen.findByText(/可能在用移动数据/)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "允许" }));
  await waitFor(() => expect(downloadPlaylist).toHaveBeenCalledTimes(1));
  expect(alert).not.toHaveBeenCalled();
});
