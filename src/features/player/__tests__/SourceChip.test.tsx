import React from "react";
import { render, screen } from "@testing-library/react-native";
import { SourceChip } from "../overlayWidgets";

const chip = (quality: string | null, count: number) => (
  <SourceChip
    quality={quality}
    position={1}
    count={count}
    accessibilityLabel="来源"
    onPress={() => {}}
  />
);

test("the source chip says only what is known", async () => {
  const ui = await render(chip("1080p", 2));
  expect(screen.getByText(/1080p/)).toBeTruthy();
  expect(screen.getByText(/· 1\/2/)).toBeTruthy();
  await ui.rerender(chip(null, 2));
  expect(screen.queryByText(/未知清晰度/)).toBeNull();
  expect(screen.getByText("1/2")).toBeTruthy();
  await ui.rerender(chip(null, 1));
  expect(screen.queryByRole("button")).toBeNull();
});
