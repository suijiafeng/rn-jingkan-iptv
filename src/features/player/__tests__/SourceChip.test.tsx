import React from "react";
import { render, screen } from "@testing-library/react-native";
import { SourceChip } from "../overlayWidgets";

const chip = (position: number, count: number) => (
  <SourceChip
    position={position}
    count={count}
    accessibilityLabel="来源"
    onPress={() => {}}
  />
);

test("the source chip shows only which address of how many", async () => {
  const ui = await render(chip(2, 3));
  expect(screen.getByText("视频来源：2/3")).toBeTruthy();
  expect(screen.queryByText(/1080p|未知清晰度/)).toBeNull();
  // A single source still shows, and opens the list with its address.
  await ui.rerender(chip(1, 1));
  expect(screen.getByText("视频来源：1/1")).toBeTruthy();
  expect(screen.getByRole("button").props.accessibilityState.disabled).toBe(
    false,
  );
  await ui.rerender(chip(1, 0));
  expect(screen.queryByRole("button")).toBeNull();
});
