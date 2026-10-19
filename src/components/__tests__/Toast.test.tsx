import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import {
  currentToast,
  hideToast,
  showToast,
  TOAST_MS,
  ToastHost,
} from "../Toast";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 0, left: 0 }),
}));

const hidden = { includeHiddenElements: true };

beforeEach(() => {
  jest.useFakeTimers();
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => {});
});
afterEach(() => {
  hideToast();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("a toast shows at the top under the status bar, is announced once, and goes after 3 s", async () => {
  await render(<ToastHost />);
  expect(screen.queryByTestId("global-toast", hidden)).toBeNull();
  await act(async () => showToast("连接超时"));
  expect(screen.getByText("连接超时", hidden)).toBeTruthy();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
    "连接超时",
  );
  const host = screen.getByTestId("global-toast-host", hidden);
  expect(host.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ top: 36 })]),
  );
  await act(async () => {
    jest.advanceTimersByTime(TOAST_MS - 1);
  });
  expect(currentToast()).toBe("连接超时");
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(currentToast()).toBeNull();
  expect(screen.queryByText("连接超时", hidden)).toBeNull();
});

test("a newer toast replaces the one showing and gets its own full time", async () => {
  await render(<ToastHost />);
  await act(async () => showToast("没有网络"));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  await act(async () => showToast("加载较慢"));
  expect(screen.queryByText("没有网络", hidden)).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(screen.getByText("加载较慢", hidden)).toBeTruthy();
  await act(async () => hideToast());
  expect(currentToast()).toBeNull();
});
