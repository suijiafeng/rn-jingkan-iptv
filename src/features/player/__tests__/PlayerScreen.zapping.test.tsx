import React from "react";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import { first, mockMounts, props, second } from "./support/playerTestKit";
import { PlayerScreen, type PlayerScreenProps } from "../PlayerScreen";
import type { Channel } from "../../../domain/types";

describe("zapping", () => {
  const third: Channel = {
    ...first,
    id: "third",
    identityKey: "three",
    name: "城市夜色",
    streamUrl: "https://example.test/three.m3u8",
    sortIndex: 2,
  };
  const swipe = async (
    ui: Awaited<ReturnType<typeof render>>,
    dy: number,
    dx = 0,
  ) => {
    const layer = ui.getByTestId("fullscreen-gesture-layer");
    await act(() => {
      layer.props.onResponderGrant({ nativeEvent: { pageX: 100, pageY: 300 } });
      layer.props.onResponderRelease({
        nativeEvent: { pageX: 100 + dx, pageY: 300 + dy },
      });
    });
  };
  const fullscreen = async (options: PlayerScreenProps) => {
    const ui = await render(<PlayerScreen {...options} />);
    await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
    return ui;
  };

  test("fullscreen swipe up selects the next channel and down the previous", async () => {
    const options = props({
      channel: second,
      channels: [first, second, third],
    });
    const ui = await fullscreen(options);
    await swipe(ui, -120);
    expect(options.onSelect).toHaveBeenLastCalledWith(third);
    await swipe(ui, 120);
    expect(options.onSelect).toHaveBeenLastCalledWith(first);
    await ui.unmount();
  });

  test("reverse setting flips swipe direction; mostly horizontal drags do nothing", async () => {
    const options = props({
      channel: second,
      channels: [first, second, third],
      swipeReverse: true,
    });
    const ui = await fullscreen(options);
    await swipe(ui, -120);
    expect(options.onSelect).toHaveBeenLastCalledWith(first);
    await swipe(ui, -80, 200);
    expect(options.onSelect).toHaveBeenCalledTimes(1);
    await ui.unmount();
  });

  test("a tap toggles controls and swiping past the end shows a boundary hint", async () => {
    const options = props({ channel: second, channels: [first, second] });
    const ui = await fullscreen(options);
    expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
    await swipe(ui, 0);
    expect(ui.queryByRole("button", { name: "退出全屏" })).toBeNull();
    await swipe(ui, -120);
    expect(options.onSelect).not.toHaveBeenCalled();
    expect(ui.getByText("已经是最后一个频道")).toBeTruthy();
    await ui.unmount();
  });

  test("TalkBack actions switch channels without gestures", async () => {
    const options = props({
      channel: second,
      channels: [first, second, third],
    });
    const ui = await fullscreen(options);
    const layer = ui.getByTestId("fullscreen-gesture-layer");
    await act(() =>
      layer.props.onAccessibilityAction({
        nativeEvent: { actionName: "increment" },
      }),
    );
    expect(options.onSelect).toHaveBeenLastCalledWith(third);
    await ui.unmount();
  });

  test("previous/next and swipes skip channels last checked unreachable when enabled", async () => {
    const dead = { ...second, checkStatus: "unreachable" as const };
    const options = props({
      channel: first,
      channels: [first, dead, third],
      skipUnreachable: true,
    });
    const ui = await render(<PlayerScreen {...options} />);
    await fireEvent.press(ui.getByRole("button", { name: "下一台" }));
    expect(options.onSelect).toHaveBeenLastCalledWith(third);
    await ui.unmount();
    const plain = props({ channel: first, channels: [first, dead, third] });
    const ui2 = await render(<PlayerScreen {...plain} />);
    await fireEvent.press(ui2.getByRole("button", { name: "下一台" }));
    expect(plain.onSelect).toHaveBeenLastCalledWith(dead);
    await ui2.unmount();
  });
});

describe("waiting and failure", () => {
  afterEach(() => jest.useRealTimers());

  // The counter re-arms after each render, so advance one second at a time.
  const seconds = async (count: number) => {
    for (let tick = 0; tick < count; tick += 1)
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
  };

  test("connecting shows elapsed seconds; after 15 s a slow hint, with zapping right in the notice", async () => {
    jest.useFakeTimers();
    const options = props();
    const ui = await render(<PlayerScreen {...options} />);
    await seconds(3);
    expect(ui.getByText(/已等 3 秒/)).toBeTruthy();
    await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
    expect(ui.queryByText(/比平时慢/)).toBeNull();
    await seconds(12);
    expect(ui.getByText(/比平时慢/)).toBeTruthy();
    expect(ui.queryByRole("button", { name: "换下一台" })).toBeNull();
    await fireEvent.press(
      within(ui.getByTestId("zap-cluster")).getByRole("button", {
        name: "下一台",
      }),
    );
    expect(options.onSelect).toHaveBeenLastCalledWith(second);
    await ui.unmount();
  });
  test("portrait loading never duplicates the visible next button", async () => {
    jest.useFakeTimers();
    const ui = await render(<PlayerScreen {...props()} />);
    await seconds(16);
    expect(ui.getByText(/比平时慢/)).toBeTruthy();
    expect(ui.queryByRole("button", { name: "换下一台" })).toBeNull();
    expect(ui.getByRole("button", { name: "下一台" })).toBeTruthy();
    await ui.unmount();
  });

  test("after a timeout, retry starts a fresh attempt and a second timeout does not hang", async () => {
    jest.useFakeTimers();
    const options = props();
    const ui = await render(<PlayerScreen {...options} />);
    await seconds(30);
    expect(ui.getByText("连接超时")).toBeTruthy();
    const mountsBefore = mockMounts.mock.calls.length;
    await fireEvent.press(ui.getByRole("button", { name: "重试" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockMounts.mock.calls.length).toBe(mountsBefore + 1);
    await seconds(30);
    expect(ui.getByText("连接超时")).toBeTruthy();
    await fireEvent.press(ui.getByRole("button", { name: "下一台" }));
    expect(options.onSelect).toHaveBeenLastCalledWith(second);
    await ui.unmount();
  });
});
