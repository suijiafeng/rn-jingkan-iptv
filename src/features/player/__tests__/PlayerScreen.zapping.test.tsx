import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { first, mockMounts, props, second } from "./support/playerTestKit";
import { PlayerScreen, type PlayerScreenProps } from "../PlayerScreen";
import { currentToast } from "../../../components/Toast";
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

  test("swipes skip channels last checked unreachable when enabled", async () => {
    const dead = { ...second, checkStatus: "unreachable" as const };
    const options = props({
      channel: first,
      channels: [first, dead, third],
      skipUnreachable: true,
    });
    const ui = await fullscreen(options);
    await swipe(ui, -120);
    expect(options.onSelect).toHaveBeenLastCalledWith(third);
    await ui.unmount();
    const plain = props({ channel: first, channels: [first, dead, third] });
    const ui2 = await fullscreen(plain);
    await swipe(ui2, -120);
    expect(plain.onSelect).toHaveBeenLastCalledWith(dead);
    await ui2.unmount();
  });

  test("the picture has no previous/next buttons in either layout", async () => {
    const ui = await render(<PlayerScreen {...props()} />);
    expect(ui.queryByRole("button", { name: /上一台|下一台/ })).toBeNull();
    await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
    expect(ui.queryByRole("button", { name: /上一台|下一台/ })).toBeNull();
    await ui.unmount();
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

  test("connecting shows breathing dots; after 15 s they slow down and a toast says so", async () => {
    jest.useFakeTimers();
    const ui = await render(<PlayerScreen {...props()} />);
    await seconds(3);
    expect(ui.getByLabelText("正在加载")).toBeTruthy();
    expect(ui.queryByText(/已等/)).toBeNull();
    expect(currentToast()).toBeNull();
    await seconds(12);
    expect(ui.getByLabelText("正在加载，比平时慢")).toBeTruthy();
    expect(currentToast()).toBe("网络较慢，正在加载");
    await ui.unmount();
  });

  test("after a timeout, retry starts a fresh attempt and a second timeout does not hang", async () => {
    jest.useFakeTimers();
    const options = props();
    const ui = await render(<PlayerScreen {...options} />);
    await seconds(30);
    expect(currentToast()).toBe("连接超时，可重试");
    const mountsBefore = mockMounts.mock.calls.length;
    await fireEvent.press(ui.getByRole("button", { name: "重试" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockMounts.mock.calls.length).toBe(mountsBefore + 1);
    await seconds(30);
    expect(currentToast()).toBe("连接超时，可重试");
    expect(ui.getByRole("button", { name: "重试" })).toBeTruthy();
    await ui.unmount();
  });
});
