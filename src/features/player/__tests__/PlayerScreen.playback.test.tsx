import React from "react";
import { BackHandler, StyleSheet } from "react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import {
  first,
  mockLock,
  mockMounts,
  mockNetworkCheck,
  mockNetworkListeners,
  mockSafeAreaInsets,
  mockUnmounts,
  props,
  second,
} from "./support/playerTestKit";
import { PlayerScreen } from "../PlayerScreen";
import { currentToast } from "../../../components/Toast";
import type { Channel } from "../../../domain/types";

test("remote consent prevents all loading, including HTTPS, and revocation tears down", async () => {
  const initial = props({ remoteAllowed: false });
  const ui = await render(<PlayerScreen {...initial} />);
  expect(mockMounts).not.toHaveBeenCalled();
  expect(mockNetworkCheck).not.toHaveBeenCalled();
  await ui.rerender(<PlayerScreen {...initial} remoteAllowed />);
  expect(mockMounts).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: "播放" }));
  expect(mockMounts).toHaveBeenCalledWith(first.streamUrl);
  await ui.rerender(<PlayerScreen {...initial} />);
  expect(mockUnmounts).toHaveBeenCalledWith(first.streamUrl);
  expect(ui.queryByTestId("mock-native-attempt")).toBeNull();
  await ui.unmount();
});

test("the video is edge-to-edge and alternative sources can be selected", async () => {
  const low: Channel = {
    ...first,
    groupKey: "iptv:cctv1.cn",
    qualityLabel: "标清",
    qualityRank: 576,
  };
  const high: Channel = {
    ...low,
    id: "high",
    streamUrl: "https://example.test/high.m3u8",
    sourceName: "备用节目单",
    qualityLabel: "高清",
    qualityRank: 720,
  };
  const onSelectSource = jest.fn();
  const ui = await render(
    <PlayerScreen
      {...props({
        channel: low,
        sources: [low, high],
        onSelectSource,
      })}
    />,
  );
  expect(ui.getByTestId("video-stage").props.style).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ borderRadius: expect.any(Number) }),
    ]),
  );
  // Portrait: the source chip opens a bottom sheet; choosing closes it.
  await fireEvent.press(
    ui.getByRole("button", {
      name: "来源：标清 · 我的节目单，共 2 个，点击切换",
    }),
  );
  expect(ui.getByTestId("source-sheet")).toBeTruthy();
  await fireEvent.press(
    within(ui.getByTestId("source-list")).getByRole("button", {
      name: "高清，备用节目单",
    }),
  );
  expect(onSelectSource).toHaveBeenCalledWith(high);
  expect(ui.queryByTestId("source-sheet")).toBeNull();
});

test("mobile transition unmounts before confirmation and never resumes on its own", async () => {
  const ui = await render(<PlayerScreen {...props()} />);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await act(() => {
    mockNetworkListeners.forEach((listener) =>
      listener({ type: "CELLULAR", isConnected: true }),
    );
  });
  expect(mockUnmounts).toHaveBeenCalledTimes(1);
  expect(ui.queryByTestId("mock-native-attempt")).toBeNull();
  expect(ui.getByText("播放将消耗流量，是否继续播放")).toBeTruthy();
  expect(currentToast()).toBeNull();
  await act(() => {
    mockNetworkListeners.forEach((listener) =>
      listener({ type: "WIFI", isConnected: true }),
    );
  });
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await fireEvent.press(ui.getByRole("button", { name: "用流量播放" }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockMounts).toHaveBeenCalledTimes(2);
  await ui.unmount();
});

test("rotation preserves the current attempt; choosing a channel closes the sheet and stays fullscreen", async () => {
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  expect(mockLock).toHaveBeenLastCalledWith(2);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
  expect(ui.getByRole("header", { name: "频道列表" })).toBeTruthy();
  await fireEvent.press(ui.getByRole("button", { name: "自然之声，播放" }));
  expect(options.onSelect).toHaveBeenCalledWith(second, [first, second]);
  expect(ui.queryByRole("header", { name: "频道列表" })).toBeNull();
  expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
  expect(mockLock).toHaveBeenLastCalledWith(0);
});

test("fullscreen media stays edge-to-edge while controls and sheets respect display insets", async () => {
  Object.assign(mockSafeAreaInsets, {
    top: 11,
    right: 13,
    bottom: 17,
    left: 19,
  });
  const ui = await render(
    <PlayerScreen {...props({ sources: [first, second] })} />,
  );
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));

  expect(ui.getByTestId("player-screen").props.edges).toEqual([]);
  expect(
    StyleSheet.flatten(ui.getByTestId("video-stage").props.style),
  ).toMatchObject({ top: 0, right: 0, bottom: 0, left: 0 });
  // Bars run to the picture's edges, offset only by the display insets.
  expect(
    StyleSheet.flatten(ui.getByTestId("fullscreen-controls").props.style),
  ).toMatchObject({ top: 11, right: 13, left: 19 });
  expect(
    StyleSheet.flatten(
      ui.getByTestId("fullscreen-bottom-controls").props.style,
    ),
  ).toMatchObject({ bottom: 17, right: 13, left: 19 });
  // The gesture layer is the whole picture, not an edge strip.
  expect(
    StyleSheet.flatten(ui.getByTestId("fullscreen-gesture-layer").props.style),
  ).toMatchObject({
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });

  await fireEvent.press(
    ui.getByRole("button", {
      name: "来源：未知清晰度 · 我的节目单，共 2 个，点击切换",
    }),
  );
  expect(
    StyleSheet.flatten(ui.getByTestId("fullscreen-sources").props.style),
  ).toMatchObject({ top: 93, right: 37, bottom: 33 });
  // Tapping outside the list closes it.
  await fireEvent.press(ui.getByTestId("fullscreen-sources-backdrop"));
  expect(ui.queryByTestId("fullscreen-sources")).toBeNull();

  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
  expect(
    StyleSheet.flatten(ui.getByTestId("player-channel-sheet").props.style),
  ).toMatchObject({ marginTop: 11, marginRight: 13, marginBottom: 17 });
  await ui.unmount();
});

test("swiping honours queue boundaries and switching releases the prior channel", async () => {
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  const swipe = async (dy: number) => {
    const layer = ui.getByTestId("fullscreen-gesture-layer");
    await act(() => {
      layer.props.onResponderGrant({ nativeEvent: { pageX: 100, pageY: 300 } });
      layer.props.onResponderRelease({
        nativeEvent: { pageX: 100, pageY: 300 + dy },
      });
    });
  };
  await swipe(120);
  expect(options.onSelect).not.toHaveBeenCalled();
  await swipe(-120);
  expect(options.onSelect).toHaveBeenCalledWith(second);
  await ui.rerender(<PlayerScreen {...options} channel={second} />);
  expect(mockUnmounts).toHaveBeenCalledWith(first.streamUrl);
  expect(mockMounts).toHaveBeenLastCalledWith(second.streamUrl);
  await swipe(-120);
  expect(options.onSelect).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("hardware back closes sheet, then fullscreen, then player", async () => {
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
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
  await act(() => {
    handler?.();
  });
  expect(ui.queryByRole("header", { name: "频道列表" })).toBeNull();
  expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
  await act(() => {
    handler?.();
  });
  expect(ui.getByRole("button", { name: "横屏全屏" })).toBeTruthy();
  expect(options.onClose).not.toHaveBeenCalled();
  await act(() => {
    handler?.();
  });
  expect(options.onClose).toHaveBeenCalledTimes(1);
  await ui.unmount();
  spy.mockRestore();
});

test("fullscreen has one accessible favorite shortcut and toggling it preserves native playback", async () => {
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  expect(
    ui.getAllByRole("button", {
      name: "收藏当前频道",
      includeHiddenElements: true,
    }),
  ).toHaveLength(1);
  await fireEvent.press(ui.getByRole("button", { name: "收藏当前频道" }));
  expect(options.onFavorite).toHaveBeenCalledWith(first);
  await ui.rerender(
    <PlayerScreen {...options} channel={{ ...first, favorite: true }} />,
  );
  expect(
    ui.getByRole("button", { name: "取消收藏当前频道" }).props
      .accessibilityState.selected,
  ).toBe(true);
  expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  expect(mockUnmounts).not.toHaveBeenCalled();
  await ui.unmount();
});

test("ticking 不再提醒 before continuing turns the mobile-data reminder off", async () => {
  const onStopMobileReminders = jest.fn();
  const onMobileAccepted = jest.fn();
  const ui = await render(
    <PlayerScreen {...props({ onStopMobileReminders, onMobileAccepted })} />,
  );
  await act(() => {
    mockNetworkListeners.forEach((listener) =>
      listener({ type: "CELLULAR", isConnected: true }),
    );
  });
  const box = ui.getByRole("checkbox", { name: "不再提醒" });
  expect(box.props.accessibilityState.checked).toBe(false);
  await fireEvent.press(box);
  expect(
    ui.getByRole("checkbox", { name: "不再提醒" }).props.accessibilityState
      .checked,
  ).toBe(true);
  expect(onStopMobileReminders).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: "用流量播放" }));
  expect(onStopMobileReminders).toHaveBeenCalledTimes(1);
  expect(onMobileAccepted).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("continuing without the box keeps the reminder on", async () => {
  const onStopMobileReminders = jest.fn();
  const ui = await render(
    <PlayerScreen {...props({ onStopMobileReminders })} />,
  );
  await act(() => {
    mockNetworkListeners.forEach((listener) =>
      listener({ type: "CELLULAR", isConnected: true }),
    );
  });
  await fireEvent.press(ui.getByRole("button", { name: "用流量播放" }));
  expect(onStopMobileReminders).not.toHaveBeenCalled();
  await ui.unmount();
});
