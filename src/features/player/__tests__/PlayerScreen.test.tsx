import React from "react";
import { AppState, BackHandler } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { PlayerScreen, type PlayerScreenProps } from "../PlayerScreen";
import type { Channel } from "../../../domain/types";

const mockNetworkCheck = jest.fn();
const mockNetworkListeners = new Set<(state: object) => void>();
const mockMounts = jest.fn();
const mockUnmounts = jest.fn();
const mockLock = jest.fn();
jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => mockNetworkCheck(),
  addNetworkStateListener: (listener: (state: object) => void) => {
    mockNetworkListeners.add(listener);
    return { remove: () => mockNetworkListeners.delete(listener) };
  },
}));
jest.mock("expo-screen-orientation", () => ({
  OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 1, LANDSCAPE: 2 },
  getOrientationLockAsync: async () => 0,
  lockAsync: (lock: number) => mockLock(lock),
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView:
    jest.requireActual<typeof import("react-native")>("react-native").View,
}));
jest.mock("../NativeAttempt", () => ({
  NativeAttempt: function MockNativeAttempt(props: {
    attemptId: number;
    uri: string;
  }) {
    const { View } =
      jest.requireActual<typeof import("react-native")>("react-native");
    const { useEffect } = jest.requireActual<typeof import("react")>("react");
    useEffect(() => {
      mockMounts(props.uri);
      return () => {
        mockUnmounts(props.uri);
      };
    }, [props.uri]);
    return <View testID="mock-native-attempt" />;
  },
}));
const first: Channel = {
  id: "first",
  identityKey: "one",
  sourceId: "source",
  sourceName: "我的节目单",
  active: true,
  lastSeenRevision: 1,
  lastPlayedAt: null,
  name: "山野纪实",
  groupName: "纪录片",
  streamUrl: "https://example.test/one.m3u8",
  logoUrl: null,
  tvgId: null,
  sortIndex: 0,
  favorite: false,
};
const second: Channel = {
  ...first,
  id: "second",
  identityKey: "two",
  name: "自然之声",
  streamUrl: "https://example.test/two.m3u8",
  sortIndex: 1,
  favorite: true,
};
const props = (more: Partial<PlayerScreenProps> = {}): PlayerScreenProps => ({
  channel: first,
  channels: [first, second],
  remoteAllowed: true,
  mobileWarning: true,
  onSelect: jest.fn(),
  onClose: jest.fn(),
  onFavorite: jest.fn(),
  onStarted: jest.fn(),
  ...more,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockNetworkListeners.clear();
  mockNetworkCheck.mockResolvedValue({ type: "WIFI", isConnected: true });
  mockLock.mockResolvedValue(undefined);
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    writable: true,
    value: "active",
  });
});

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

test("mobile transition unmounts before confirmation and decline stays stopped", async () => {
  const ui = await render(<PlayerScreen {...props()} />);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await act(() => {
    mockNetworkListeners.forEach((listener) =>
      listener({ type: "CELLULAR", isConnected: true }),
    );
  });
  expect(mockUnmounts).toHaveBeenCalledTimes(1);
  expect(ui.queryByTestId("mock-native-attempt")).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: "暂不播放" }));
  await act(() => {
    mockNetworkListeners.forEach((listener) =>
      listener({ type: "WIFI", isConnected: true }),
    );
  });
  expect(mockMounts).toHaveBeenCalledTimes(1);
  expect(ui.getByRole("button", { name: "播放" })).toBeTruthy();
  await ui.unmount();
});

test("rotation preserves the current attempt; choosing a channel closes the sheet and stays fullscreen", async () => {
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  await fireEvent.press(ui.getByRole("button", { name: "横屏全屏" }));
  expect(mockLock).toHaveBeenLastCalledWith(2);
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await fireEvent.press(ui.getByRole("button", { name: "频道列表" }));
  expect(ui.getByText("选择频道")).toBeTruthy();
  await fireEvent.press(
    ui.getByRole("button", { name: "自然之声，我的节目单" }),
  );
  expect(options.onSelect).toHaveBeenCalledWith(second);
  expect(ui.queryByText("选择频道")).toBeNull();
  expect(ui.getByRole("button", { name: "退出全屏" })).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await ui.unmount();
  expect(mockLock).toHaveBeenLastCalledWith(0);
});

test("previous/next honor queue boundaries and switching releases prior channel", async () => {
  const options = props();
  const ui = await render(<PlayerScreen {...options} />);
  expect(
    ui.getByRole("button", { name: "上一台" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  await fireEvent.press(ui.getByRole("button", { name: "下一台" }));
  expect(options.onSelect).toHaveBeenCalledWith(second);
  await ui.rerender(<PlayerScreen {...options} channel={second} />);
  expect(mockUnmounts).toHaveBeenCalledWith(first.streamUrl);
  expect(mockMounts).toHaveBeenLastCalledWith(second.streamUrl);
  expect(
    ui.getByRole("button", { name: "下一台" }).props.accessibilityState
      .disabled,
  ).toBe(true);
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
  expect(ui.queryByText("选择频道")).toBeNull();
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
