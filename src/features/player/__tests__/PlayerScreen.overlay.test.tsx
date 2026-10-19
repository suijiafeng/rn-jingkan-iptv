import React from "react";
import { Alert, BackHandler } from "react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import {
  first,
  mockAttempt,
  mockMounts,
  mockNative,
  mockUnmounts,
  props,
  second,
  sheet,
} from "./support/playerTestKit";
import { PlayerScreen } from "../PlayerScreen";
import { currentToast } from "../../../components/Toast";

describe("one overlay instead of native controls", () => {
  test("mute toggles in portrait, fullscreen and docked layouts and survives channel changes", async () => {
    const initial = props();
    const ui = await render(<PlayerScreen {...initial} />);
    await fireEvent.press(ui.getByRole("button", { name: "静音" }));
    expect(
      ui.getByRole("button", { name: "取消静音" }).props.accessibilityState
        .selected,
    ).toBe(true);
    expect(mockNative.muted).toBe(true);
    expect(mockMounts).toHaveBeenCalledTimes(1);
    const next = { ...initial, channel: second, sources: [second] };
    await ui.rerender(<PlayerScreen {...next} />);
    expect(ui.getByRole("button", { name: "取消静音" })).toBeTruthy();
    expect(mockNative.muted).toBe(true);
    await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
    await fireEvent.press(ui.getByRole("button", { name: "取消静音" }));
    expect(mockNative.muted).toBe(false);
    await ui.rerender(<PlayerScreen {...next} mini />);
    await fireEvent.press(ui.getByRole("button", { name: "静音" }));
    expect(mockNative.muted).toBe(true);
    expect(mockMounts).toHaveBeenCalledTimes(2);
  });
  const start = async () => {
    await act(() =>
      mockAttempt?.controller.nativeStarted(mockAttempt.attemptId),
    );
  };

  test("fullscreen: play/pause sits in the middle, zapping is a swipe; the bars hold identity and choices", async () => {
    const options = props({
      previousChannel: second,
      sources: [first, second],
    });
    const ui = await render(<PlayerScreen {...options} />);
    await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
    await start();
    expect(ui.queryByRole("button", { name: /上一台|下一台/ })).toBeNull();
    const top = within(ui.getByTestId("fullscreen-controls"));
    expect(top.getByRole("button", { name: "退出全屏" })).toBeTruthy();
    expect(top.getByRole("button", { name: "收藏当前频道" })).toBeTruthy();
    expect(ui.getByTestId("primary-play-pause").props.accessibilityLabel).toBe(
      "暂停",
    );
    const bottom = within(ui.getByTestId("fullscreen-bottom-controls"));
    expect(bottom.queryByRole("button", { name: "暂停" })).toBeNull();
    expect(bottom.getByLabelText("直播，不可回看")).toBeTruthy();
    expect(
      top.getByRole("button", {
        name: "来源：未知清晰度 · 我的节目单，共 2 个，点击切换",
      }),
    ).toBeTruthy();
    expect(bottom.getByRole("button", { name: "频道列表" })).toBeTruthy();
    expect(bottom.queryByRole("button", { name: "进入画中画" })).toBeNull();
    expect(ui.queryByRole("button", { name: /回到上一个频道/ })).toBeNull();
    expect(ui.queryByTestId("media-timeline")).toBeNull();
    await fireEvent.press(bottom.getByRole("button", { name: "退出横屏" }));
    expect(ui.queryByTestId("fullscreen-bottom-controls")).toBeNull();
    expect(ui.getByRole("button", { name: "横屏全屏" })).toBeTruthy();
    await ui.unmount();
  });

  test("pausing plain live releases the attempt; playing again reconnects", async () => {
    const ui = await render(<PlayerScreen {...props()} />);
    await start();
    await fireEvent.press(ui.getByTestId("primary-play-pause"));
    expect(mockNative.pause).not.toHaveBeenCalled();
    expect(mockUnmounts).toHaveBeenCalledTimes(1);
    expect(ui.queryByText("已暂停")).toBeNull(); // plain pause: dimmed picture and ▶ only
    await fireEvent.press(ui.getByRole("button", { name: "播放" }));
    expect(mockMounts).toHaveBeenCalledTimes(2);
    await ui.unmount();
  });

  test("catch-up streams get a timeline and pause in place without reconnecting", async () => {
    Object.assign(mockNative, { duration: 3600, currentTime: 1800 });
    const ui = await render(<PlayerScreen {...props()} />);
    await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
    await start();
    expect(ui.getByTestId("media-timeline")).toBeTruthy();
    expect(ui.getByText("-30:00")).toBeTruthy();
    await fireEvent.press(ui.getByRole("button", { name: "回到直播" }));
    expect(mockNative.currentTime).toBe(3590);
    await fireEvent.press(ui.getByTestId("primary-play-pause"));
    expect(mockNative.pause).toHaveBeenCalledTimes(1);
    expect(mockUnmounts).not.toHaveBeenCalled();
    expect(ui.getByTestId("primary-play-pause").props.accessibilityLabel).toBe(
      "播放",
    );
    await fireEvent.press(ui.getByTestId("primary-play-pause"));
    expect(mockNative.play).toHaveBeenCalledTimes(1);
    expect(mockMounts).toHaveBeenCalledTimes(1);
    await ui.unmount();
  });

  test("in portrait a tap on the picture toggles the play/pause overlay", async () => {
    const ui = await render(<PlayerScreen {...props()} />);
    await start();
    expect(ui.getByTestId("primary-play-pause")).toBeTruthy();
    const layer = ui.getByTestId("video-tap-layer");
    await act(() => {
      layer.props.onResponderGrant({ nativeEvent: { pageX: 50, pageY: 50 } });
      layer.props.onResponderRelease({ nativeEvent: { pageX: 50, pageY: 50 } });
    });
    expect(ui.queryByTestId("primary-play-pause")).toBeNull();
    // A vertical drag in portrait never changes channel.
    await act(() => {
      layer.props.onResponderGrant({ nativeEvent: { pageX: 50, pageY: 300 } });
      layer.props.onResponderRelease({
        nativeEvent: { pageX: 50, pageY: 100 },
      });
    });
    await ui.unmount();
  });

  test("resuming live after a long pause reconnects; on-demand retains its position", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000);
    Object.assign(mockNative, {
      isLive: true,
      duration: 3600,
      currentTime: 1800,
    });
    const ui = await render(<PlayerScreen {...props()} />);
    try {
      await start();
      await fireEvent.press(ui.getByTestId("primary-play-pause"));
      now.mockReturnValue(61_001);
      await fireEvent.press(ui.getByTestId("primary-play-pause"));
      expect(mockMounts).toHaveBeenCalledTimes(2);
      expect(mockUnmounts).toHaveBeenCalledTimes(1);
      expect(mockNative.play).not.toHaveBeenCalled();
    } finally {
      await ui.unmount();
      now.mockRestore();
    }

    Object.assign(mockNative, {
      isLive: false,
      duration: 3600,
      currentTime: 1800,
    });
    const clock = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const movie = await render(<PlayerScreen {...props()} />);
    try {
      await start();
      await fireEvent.press(movie.getByTestId("primary-play-pause"));
      const mounts = mockMounts.mock.calls.length;
      clock.mockReturnValue(121_001);
      await fireEvent.press(movie.getByTestId("primary-play-pause"));
      expect(mockMounts).toHaveBeenCalledTimes(mounts);
      expect(mockNative.play).toHaveBeenCalledTimes(1);
      expect(mockNative.currentTime).toBe(1800);
    } finally {
      await movie.unmount();
      clock.mockRestore();
    }
  });
});

describe("portrait layout", () => {
  test("the channel list sits under the picture with no sheet to open", async () => {
    const options = props({ sheet: sheet([first, second]) });
    const ui = await render(<PlayerScreen {...options} />);
    expect(ui.queryByRole("button", { name: /打开频道列表/ })).toBeNull();
    expect(ui.queryByRole("header", { name: "频道列表" })).toBeNull();
    expect(ui.getByTestId("player-channel-list")).toBeTruthy();
    expect(ui.queryByRole("button", { name: "定位当前频道" })).toBeNull();
    // The heading names the channel and its groups; the source's name is
    // only spoken by the chip and listed in the sheet it opens.
    const info = within(ui.getByTestId("portrait-info"));
    expect(info.getByText("山野纪实")).toBeTruthy();
    expect(info.getByText("纪录片")).toBeTruthy();
    expect(info.queryByText(/我的节目单/)).toBeNull();
    expect(ui.queryByRole("button", { name: /上一台|下一台/ })).toBeNull();
    expect(
      ui.getByRole("button", { name: "来源：未知清晰度 · 我的节目单" }).props
        .accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.press(
      ui.getByRole("button", { name: "停止播放并关闭播放器" }),
    );
    expect(options.onClose).toHaveBeenCalledTimes(1);
    await ui.unmount();
  });

  test("hardware back closes the source sheet before anything else", async () => {
    let handler: (() => boolean | null | undefined) | undefined;
    const spy = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((_event, listener) => {
        handler = () =>
          listener({ type: "hardwareBackPress" } as Parameters<
            typeof listener
          >[0]);
        return { remove: jest.fn() };
      });
    const options = props({ sources: [first, second] });
    const ui = await render(<PlayerScreen {...options} />);
    await fireEvent.press(
      ui.getByRole("button", {
        name: "来源：未知清晰度 · 我的节目单，共 2 个，点击切换",
      }),
    );
    expect(ui.getByTestId("source-sheet")).toBeTruthy();
    await act(() => {
      handler?.();
    });
    expect(ui.queryByTestId("source-sheet")).toBeNull();
    expect(options.onClose).not.toHaveBeenCalled();
    await act(() => {
      handler?.();
    });
    expect(options.onClose).toHaveBeenCalledTimes(1);
    await ui.unmount();
    spy.mockRestore();
  });
});

describe("docked bar", () => {
  const start = async () => {
    await act(() =>
      mockAttempt?.controller.nativeStarted(mockAttempt.attemptId),
    );
  };
  const backKey = () => {
    let handler: (() => boolean | null | undefined) | undefined;
    const spy = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((_event, listener) => {
        handler = () =>
          listener({ type: "hardwareBackPress" } as Parameters<
            typeof listener
          >[0]);
        return { remove: jest.fn() };
      });
    return { press: () => act(() => void handler?.()), spy };
  };

  test("portrait back minimizes when the owner allows it; the bar keeps the attempt", async () => {
    const { press, spy } = backKey();
    const options = props({ onMinimize: jest.fn(), onExpand: jest.fn() });
    const ui = await render(<PlayerScreen {...options} />);
    await start();
    await press();
    expect(options.onMinimize).toHaveBeenCalledTimes(1);
    expect(options.onClose).not.toHaveBeenCalled();
    await ui.rerender(<PlayerScreen {...options} mini />);
    // Same session and stream: nothing was unmounted or reconnected.
    expect(mockMounts).toHaveBeenCalledTimes(1);
    expect(mockUnmounts).not.toHaveBeenCalled();
    expect(ui.queryByTestId("player-channel-list")).toBeNull();
    expect(ui.queryByTestId("video-tap-layer")).toBeNull();
    expect(
      ui.getAllByRole("button", { name: "展开播放器，山野纪实" }),
    ).toHaveLength(2);
    await fireEvent.press(
      ui.getAllByRole("button", { name: "展开播放器，山野纪实" })[1],
    );
    expect(options.onExpand).toHaveBeenCalledTimes(1);
    // While docked the bar stops on back; stop is also one tap away.
    await press();
    expect(options.onClose).toHaveBeenCalledTimes(1);
    await fireEvent.press(ui.getByRole("button", { name: "停止播放" }));
    expect(options.onClose).toHaveBeenCalledTimes(2);
    await ui.rerender(<PlayerScreen {...options} />);
    expect(ui.getByTestId("player-channel-list")).toBeTruthy();
    expect(mockMounts).toHaveBeenCalledTimes(1);
    await ui.unmount();
    spy.mockRestore();
  });

  test("the bar's play/pause drives the same controller", async () => {
    const options = props({ mini: true });
    const ui = await render(<PlayerScreen {...options} />);
    await start();
    await fireEvent.press(ui.getByRole("button", { name: "暂停" }));
    expect(mockUnmounts).toHaveBeenCalledTimes(1);
    // The docked bar still names the state in its subtitle.
    expect(ui.getByText("已暂停")).toBeTruthy();
    await fireEvent.press(ui.getByRole("button", { name: "播放" }));
    expect(mockMounts).toHaveBeenCalledTimes(2);
    await ui.unmount();
  });

  test("without onMinimize, portrait back still closes the player", async () => {
    const { press, spy } = backKey();
    const options = props();
    const ui = await render(<PlayerScreen {...options} />);
    await press();
    expect(options.onClose).toHaveBeenCalledTimes(1);
    await ui.unmount();
    spy.mockRestore();
  });
});

describe("primary control", () => {
  afterEach(() => jest.useRealTimers());

  test("connecting shows only the dots; a failure shows a centred retry with a toast; playback a centred play/pause", async () => {
    jest.useFakeTimers();
    const ui = await render(<PlayerScreen {...props()} />);
    const primary = () => ui.getByTestId("primary-play-pause");
    expect(ui.getByTestId("loading-dots")).toBeTruthy();
    expect(ui.queryByTestId("primary-play-pause")).toBeNull();
    for (let tick = 0; tick < 30; tick += 1)
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    expect(currentToast()).toBe("连接超时");
    expect(ui.queryByText("连接超时")).toBeNull();
    expect(ui.queryByTestId("primary-play-pause")).toBeNull();
    await fireEvent.press(ui.getByRole("button", { name: "重试" }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(() =>
      mockAttempt?.controller.nativeStarted(mockAttempt.attemptId),
    );
    expect(primary().props.accessibilityLabel).toBe("暂停");
    await fireEvent.press(primary());
    expect(ui.queryByText("已暂停")).toBeNull(); // plain pause: dimmed picture and ▶ only
    expect(primary().props.accessibilityLabel).toBe("播放");
    expect(ui.queryByRole("button", { name: "重试" })).toBeNull();
    await ui.unmount();
  });
});

test("listening survives docking and channel changes, and switching back retains playback", async () => {
  const initial = props({ backgroundAllowed: true });
  const ui = await render(<PlayerScreen {...initial} />);
  await fireEvent.press(ui.getByRole("button", { name: "听音频" }));
  expect(ui.getByTestId("audio-stage")).toBeTruthy();
  expect(ui.queryByRole("button", { name: "横屏全屏" })).toBeNull();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.rerender(<PlayerScreen {...initial} mini />);
  expect(ui.getByTestId("audio-stage")).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.rerender(
    <PlayerScreen {...initial} channel={second} sources={[second]} />,
  );
  expect(ui.getByTestId("audio-stage")).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(2);
  await fireEvent.press(ui.getByRole("button", { name: "看视频" }));
  expect(ui.queryByTestId("audio-stage")).toBeNull();
  expect(mockMounts).toHaveBeenCalledTimes(2);
  await ui.unmount();
});

test("fullscreen and docked listening switches retain the native attempt", async () => {
  const initial = props({ backgroundAllowed: true });
  const ui = await render(<PlayerScreen {...initial} />);
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  await fireEvent.press(ui.getByRole("button", { name: "听音频" }));
  expect(ui.getByTestId("audio-stage")).toBeTruthy();
  expect(ui.queryByTestId("fullscreen-bottom-controls")).toBeNull();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.rerender(<PlayerScreen {...initial} mini />);
  await fireEvent.press(ui.getByRole("button", { name: "看视频" }));
  expect(ui.queryByTestId("audio-stage")).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: "听音频" }));
  expect(ui.getByTestId("audio-stage")).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("listening requires explicit confirmation for background permission and can stay foreground only", async () => {
  const enable = jest.fn();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    const ui = await render(
      <PlayerScreen {...props({ onEnableBackgroundPlayback: enable })} />,
    );
    await fireEvent.press(ui.getByRole("button", { name: "听音频" }));
    expect(enable).not.toHaveBeenCalled();
    expect(ui.getByTestId("audio-stage")).toBeTruthy();
    expect(ui.queryByText(/后台播放未开启/)).toBeNull();
    const choices = alert.mock.calls[0][2]!;
    expect(choices.find((item) => item.text === "仅前台收听")?.style).toBe(
      "cancel",
    );
    await act(() =>
      choices.find((item) => item.text === "仅前台收听")?.onPress?.(),
    );
    expect(enable).not.toHaveBeenCalled();
    await fireEvent.press(ui.getByRole("button", { name: "锁屏继续听" }));
    await act(() =>
      alert.mock.calls[1]
        [2]!.find((item) => item.text === "开启后台播放")
        ?.onPress?.(),
    );
    expect(enable).toHaveBeenCalledTimes(1);
    await ui.unmount();
  } finally {
    alert.mockRestore();
  }
});
