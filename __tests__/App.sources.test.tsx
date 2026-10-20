import React from "react";
import {
  mockPlayerProps,
  mockManagerProps,
  repo,
  checkSource,
  openSourceManager,
  resetAppMocks,
} from "./support/appTestKit";
import { Alert, AppState, type AppStateStatus } from "react-native";
import * as Network from "expo-network";
import {
  fireEvent,
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import App from "../src/App";
import { checkChannels } from "../src/features/source/availability";
import type { Channel, ChannelQuery } from "../src/domain/types";

beforeEach(() => {
  resetAppMocks();
  // The source fixture reports two channels: give the shared checker real
  // targets instead of relying on an empty sweep still running a preflight.
  repo.listChannels.mockImplementation(async (query?: { sourceId?: string }) =>
    query?.sourceId
      ? ([
          { id: "a", streamUrl: "https://a.example.com/a" },
          { id: "b", streamUrl: "https://a.example.com/b" },
        ] as never[])
      : [],
  );
});

test("availability check never sends requests without network consent", async () => {
  await openSourceManager();
  await fireEvent.press(screen.getByRole("button", { name: "测试连通" }));
  await fireEvent.press(await screen.findByRole("button", { name: "不用了" }));
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
  repo.listChannels.mockImplementation(async (query?: { sourceId?: string }) =>
    query?.sourceId ? (channels as never[]) : [],
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
  await fireEvent.press(screen.getByRole("button", { name: "测试连通" }));
  await waitFor(() =>
    expect(screen.getByText("正在测试连通 1/2")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("停止测试"));
  await waitFor(() =>
    expect(repo.saveCheckResults).toHaveBeenCalledWith([
      { channelId: "a", streamUrl: "https://a.example.com/a", ok: true },
    ]),
  );
  await waitFor(() => expect(screen.getByText(/测试已停止/)).toBeTruthy());
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
      .mockImplementation((_title, _message, buttons) =>
        buttons?.[1]?.onPress?.(),
      );
    const ui = await openSourceManager();
    (repo.listChannels as jest.Mock).mockResolvedValue([
      { id: "a", streamUrl: "https://a.example.com/live" },
    ]);
    try {
      await fireEvent.press(screen.getByRole("button", { name: "测试连通" }));
      await waitFor(() =>
        expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1),
      );
      if (action === "revocation") {
        await fireEvent.press(screen.getByRole("button", { name: "返回" }));
        await fireEvent.press(
          screen.getByRole("button", { name: "撤销联网许可" }),
        );
        await waitFor(() =>
          expect(screen.getByText("了解说明并允许")).toBeTruthy(),
        );
      } else if (action === "background") {
        await act(async () => {
          listeners.forEach((listener) => listener("background"));
          listeners.forEach((listener) => listener("active"));
        });
      } else if (action === "stop") {
        await fireEvent.press(screen.getByText("停止测试"));
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
  await fireEvent.press(screen.getByRole("button", { name: "测试连通" }));
  await waitFor(() =>
    expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1),
  );
  await fireEvent.press(screen.getByText("停止测试"));
  await fireEvent.press(screen.getByRole("button", { name: "测试连通" }));
  await waitFor(() => expect(checkChannels).toHaveBeenCalledTimes(1));
  await act(async () => finishPreflight({ type: "WIFI", isConnected: true }));
  expect(screen.getByText("停止测试")).toBeTruthy();
  expect(checkChannels).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText("停止测试"));
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
  await fireEvent.press(screen.getByRole("button", { name: "测试连通" }));
  await waitFor(() =>
    expect(screen.getByText("当前没有可用网络，请连接后重试")).toBeTruthy(),
  );
  expect(screen.getByRole("header", { name: "节目来源" })).toBeTruthy();
  expect(checkChannels).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("关闭提示"));
  expect(screen.queryByText("当前没有可用网络，请连接后重试")).toBeNull();
});

test("source deletion failure is shown inside source management", async () => {
  repo.deleteSource.mockRejectedValueOnce(new Error("disk unavailable"));
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[1]?.onPress?.(),
    );
  await openSourceManager();
  await fireEvent.press(screen.getByRole("button", { name: "更多操作" }));
  await fireEvent.press(screen.getByText("删除", { exact: true }));
  await waitFor(() =>
    expect(screen.getByText("删除未完成，请重试")).toBeTruthy(),
  );
  expect(screen.getByRole("header", { name: "节目来源" })).toBeTruthy();
});

test("source enable changes are persisted and failures stay visible in management", async () => {
  repo.setSourceEnabled.mockRejectedValueOnce(new Error("disk unavailable"));
  await openSourceManager();

  await fireEvent(screen.getByLabelText("停用"), "valueChange", false);

  await waitFor(() =>
    expect(repo.setSourceEnabled).toHaveBeenCalledWith(checkSource.id, false),
  );
  expect(screen.getByText("来源未能停用，请重试")).toBeTruthy();
  expect(screen.getByRole("header", { name: "节目来源" })).toBeTruthy();
});

test("deleting one playback source refreshes alternatives and switches off the deleted address", async () => {
  const primary = {
    id: "primary",
    groupKey: "iptv:cctv1.cn",
    name: "CCTV-1",
    active: true,
    favorite: false,
    sourceId: "s1",
    sourceName: "来源一",
    groupName: "新闻",
  };
  const backup = {
    ...primary,
    id: "backup",
    sourceId: "s2",
    sourceName: "来源二",
  };
  let deleted = false;
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  repo.listSources.mockResolvedValue([
    { ...checkSource, id: "s1", name: "来源一" },
    { ...checkSource, id: "s2", name: "来源二" },
  ] as never[]);
  (repo.listChannels as jest.Mock).mockImplementation(
    async (query?: ChannelQuery) =>
      query?.mode === "recent" ? [] : ([primary] as never[]),
  );
  repo.getChannel.mockImplementation(async (id) =>
    id === primary.id && !deleted ? primary : id === backup.id ? backup : null,
  );
  (repo.listChannelSources as jest.Mock).mockImplementation(async () =>
    deleted ? [backup] : [primary, backup],
  );
  repo.deleteSource.mockImplementation(async () => {
    deleted = true;
  });
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[1]?.onPress?.(),
    );

  await render(<App />);
  await fireEvent.press(await screen.findByLabelText("CCTV-1，播放"));
  await waitFor(() => expect(mockPlayerProps).toHaveBeenCalled());
  await act(async () =>
    mockManagerProps.mock.calls.at(-1)![0].onRemove({
      ...checkSource,
      id: "s1",
      name: "来源一",
    }),
  );
  await waitFor(() => {
    const player = mockPlayerProps.mock.calls.at(-1)![0];
    expect(player.channel.id).toBe("backup");
    expect(player.sources.map((source: Channel) => source.id)).toEqual([
      "backup",
    ]);
  });
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
  await fireEvent.press(screen.getByRole("button", { name: "测试连通" }));
  await waitFor(() => expect(checkChannels).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByText("停止测试"));
  await waitFor(() =>
    expect(screen.getByText("测试结果未保存，可重新测试")).toBeTruthy(),
  );
  expect(screen.getByRole("header", { name: "节目来源" })).toBeTruthy();
});

test("rename failure remains visible with the input and a working retry", async () => {
  repo.renameSource.mockRejectedValueOnce(new Error("disk unavailable"));
  await openSourceManager();
  await fireEvent.press(screen.getByRole("button", { name: "更多操作" }));
  await fireEvent.press(screen.getByText("改名", { exact: true }));
  await fireEvent.changeText(screen.getByLabelText("来源名称"), "新的名称");
  await fireEvent.press(screen.getByText("保存名称"));
  await waitFor(() =>
    expect(screen.getByText("名称未保存，请重试")).toBeTruthy(),
  );
  expect(screen.getByDisplayValue("新的名称")).toBeTruthy();
  await fireEvent.press(screen.getByText("保存名称"));
  await waitFor(() =>
    expect(screen.getByRole("header", { name: "节目来源" })).toBeTruthy(),
  );
  expect(screen.queryByText("名称未保存，请重试")).toBeNull();
  expect(repo.renameSource).toHaveBeenCalledTimes(2);
});

test("the add form opens over management, which never closes and reopens", async () => {
  await openSourceManager();
  await fireEvent.press(screen.getByRole("button", { name: "添加节目来源" }));
  // Management stays mounted underneath: on Android, closing one modal
  // while opening another could leave the new one undrawn but touchable.
  expect(screen.getByRole("header", { name: "节目来源" })).toBeTruthy();
  expect(screen.getByLabelText("节目单链接")).toBeTruthy();
  await fireEvent.press(
    screen.getAllByRole("button", { name: "返回" }).at(-1)!,
  );
  await waitFor(() => expect(screen.queryByLabelText("节目单链接")).toBeNull());
  expect(screen.getByRole("header", { name: "节目来源" })).toBeTruthy();
});
