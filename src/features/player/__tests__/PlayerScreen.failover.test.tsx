import React from "react";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import {
  first,
  mockAttempt,
  mockMounts,
  mockNetworkListeners,
  mockUnmounts,
  props,
} from "./support/playerTestKit";
import { PlayerScreen } from "../PlayerScreen";
import type { Channel } from "../../../domain/types";

describe("automatic source failover", () => {
  afterEach(() => jest.useRealTimers());
  const grouped: Channel = { ...first, groupKey: "iptv:shanye.cn" };
  const low: Channel = { ...grouped, qualityLabel: "标清", qualityRank: 576 };
  const mid: Channel = {
    ...grouped,
    id: "mid",
    streamUrl: "https://example.test/mid.m3u8",
    sourceName: "备用节目单",
    qualityLabel: "高清",
    qualityRank: 720,
    sortIndex: 1,
  };
  const high: Channel = {
    ...grouped,
    id: "high",
    streamUrl: "https://example.test/high.m3u8",
    sourceName: "第三节目单",
    qualityLabel: "1080p",
    qualityRank: 1080,
    sortIndex: 2,
  };
  const sources = [low, mid, high];
  const seconds = async (count: number) => {
    for (let tick = 0; tick < count; tick += 1)
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
  };
  const settle = () =>
    act(async () => {
      await Promise.resolve();
    });
  /** Stands in for App: a chosen source becomes the playing channel. */
  function Harness({
    start,
    onSelectSource,
  }: {
    start: Channel;
    onSelectSource: jest.Mock;
  }) {
    const [channel, setChannel] = React.useState(start);
    return (
      <PlayerScreen
        {...props({
          channel,
          sources,
          onSelectSource: (source) => {
            onSelectSource(source);
            setChannel(source);
          },
        })}
      />
    );
  }

  test("a timeout moves to the second source and says so without the address", async () => {
    jest.useFakeTimers();
    const onSelectSource = jest.fn();
    const ui = await render(
      <Harness start={low} onSelectSource={onSelectSource} />,
    );
    await seconds(30);
    await settle();
    expect(onSelectSource).toHaveBeenCalledTimes(1);
    expect(onSelectSource).toHaveBeenCalledWith(mid);
    expect(mockUnmounts).toHaveBeenCalledWith(low.streamUrl);
    expect(mockMounts).toHaveBeenLastCalledWith(mid.streamUrl);
    expect(ui.getByText("来源 2/3 连接中")).toBeTruthy();
    expect(ui.queryByText(/example\.test/)).toBeNull();
    await ui.unmount();
  });
  test("after every source failed, only the manual retry remains and it starts a new round", async () => {
    jest.useFakeTimers();
    const onSelectSource = jest.fn();
    const ui = await render(
      <Harness start={low} onSelectSource={onSelectSource} />,
    );
    await seconds(30);
    await settle();
    await act(() =>
      mockAttempt?.controller.nativeStatus(
        mockAttempt.attemptId,
        "error",
        "network",
      ),
    );
    await settle();
    expect(onSelectSource).toHaveBeenLastCalledWith(high);
    expect(ui.getByText("来源 3/3 连接中")).toBeTruthy();
    await seconds(30);
    await settle();
    expect(onSelectSource).toHaveBeenCalledTimes(2);
    expect(ui.getByText("连接超时")).toBeTruthy();
    expect(ui.getByText(/3 个来源都试过了/)).toBeTruthy();
    expect(ui.getByRole("button", { name: "重试" })).toBeTruthy();
    const mountsBefore = mockMounts.mock.calls.length;
    await fireEvent.press(ui.getByRole("button", { name: "重试" }));
    await settle();
    expect(mockMounts.mock.calls.length).toBe(mountsBefore + 1);
    expect(mockMounts).toHaveBeenLastCalledWith(high.streamUrl);
    expect(ui.getByText("正在连接")).toBeTruthy();
    // The retry opened a new round: the next failure walks on from here.
    await seconds(30);
    await settle();
    expect(onSelectSource).toHaveBeenCalledTimes(3);
    expect(onSelectSource).toHaveBeenLastCalledWith(low);
    await ui.unmount();
  });
  test("an unknown native error keeps the source and offers the manual retry", async () => {
    const onSelectSource = jest.fn();
    const ui = await render(
      <Harness start={low} onSelectSource={onSelectSource} />,
    );
    await settle();
    await act(() =>
      mockAttempt?.controller.nativeStatus(mockAttempt.attemptId, "error"),
    );
    await settle();
    expect(onSelectSource).not.toHaveBeenCalled();
    expect(mockMounts).toHaveBeenCalledTimes(1);
    expect(ui.getByText("暂时无法播放")).toBeTruthy();
    expect(ui.queryByText(/个来源都试过了/)).toBeNull();
    expect(ui.getByRole("button", { name: "重试" })).toBeTruthy();
    await ui.unmount();
  });
  test("a manually chosen source starts the round; the walk wraps to the first", async () => {
    jest.useFakeTimers();
    const onSelectSource = jest.fn();
    const ui = await render(
      <Harness start={low} onSelectSource={onSelectSource} />,
    );
    await settle();
    await fireEvent.press(
      ui.getByRole("button", {
        name: "来源：标清 · 我的节目单，共 3 个，点击切换",
      }),
    );
    await fireEvent.press(
      within(ui.getByTestId("source-list")).getByRole("button", {
        name: "1080p，第三节目单",
      }),
    );
    await settle();
    expect(onSelectSource).toHaveBeenLastCalledWith(high);
    // A manual choice is not an automatic switch: plain copy while connecting.
    expect(ui.getByText("正在连接")).toBeTruthy();
    await seconds(30);
    await settle();
    expect(onSelectSource).toHaveBeenLastCalledWith(low);
    expect(ui.getByText("来源 1/3 连接中")).toBeTruthy();
    await seconds(30);
    await settle();
    expect(onSelectSource).toHaveBeenLastCalledWith(mid);
    await seconds(30);
    await settle();
    expect(onSelectSource).toHaveBeenCalledTimes(3);
    expect(ui.getByText("连接超时")).toBeTruthy();
    await ui.unmount();
  });
  test("offline and a user pause never switch sources", async () => {
    jest.useFakeTimers();
    const onSelectSource = jest.fn();
    const ui = await render(
      <Harness start={low} onSelectSource={onSelectSource} />,
    );
    await settle();
    await fireEvent.press(ui.getByRole("button", { name: "取消" }));
    await fireEvent.press(ui.getByRole("button", { name: "播放" }));
    await settle();
    await act(async () => {
      mockNetworkListeners.forEach((listener) =>
        listener({ type: "NONE", isConnected: false }),
      );
    });
    expect(ui.getByText("没有网络")).toBeTruthy();
    expect(onSelectSource).not.toHaveBeenCalled();
    await ui.unmount();
  });
});
