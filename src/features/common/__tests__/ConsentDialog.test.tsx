import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { askConsent, ConsentHost, currentConsent } from "../ConsentDialog";
import {
  ARTWORK_CONSENT,
  BACKGROUND_CONSENT,
  IP_CONSENT,
  LOCATION_CONSENT,
} from "../consents";

test("a consent shows short points and folds its full text one tap away", async () => {
  await render(<ConsentHost />);
  let answer!: Promise<string>;
  await act(async () => {
    answer = askConsent(IP_CONSENT);
  });
  expect(screen.getByText("ipapi.co 会看到你的 IP")).toBeTruthy();
  expect(screen.queryByText(IP_CONSENT.details)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "完整说明 ›" }));
  expect(screen.getByText(IP_CONSENT.details)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "跳过" }));
  await expect(answer).resolves.toBe("skip");
  expect(currentConsent()).toBeNull();
});

test("a newer question dismisses the unanswered one", async () => {
  const first = askConsent(ARTWORK_CONSENT);
  const second = askConsent(BACKGROUND_CONSENT);
  await expect(first).resolves.toBe("deny");
  expect(currentConsent()?.title).toBe("允许后台播放？");
  await render(<ConsentHost />);
  await fireEvent.press(screen.getByRole("button", { name: "允许后台播放" }));
  await expect(second).resolves.toBe("allow");
});

test("the folded texts keep what the native layer cannot promise", () => {
  expect(ARTWORK_CONSENT.details).toContain("无法保证全程加密");
  expect(LOCATION_CONSENT.details).toContain("不启用后台定位");
  for (const request of [
    ARTWORK_CONSENT,
    BACKGROUND_CONSENT,
    IP_CONSENT,
    LOCATION_CONSENT,
  ])
    for (const point of request.points)
      expect(point.length).toBeLessThanOrEqual(18);
});
