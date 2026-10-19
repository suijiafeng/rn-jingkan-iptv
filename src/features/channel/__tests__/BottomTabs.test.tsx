import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { BottomTabs } from "../BottomTabs";

test("bottom navigation has one ordered icon tab per destination and repeated taps preserve it", async () => {
  const change = jest.fn();
  await render(<BottomTabs tab="favorites" onChange={change} />);
  expect(
    screen.getAllByRole("tab").map((tab) => tab.props.accessibilityLabel),
  ).toEqual(["频道", "收藏", "最近", "设置"]);
  const favorites = screen.getByRole("tab", { name: "收藏" });
  expect(favorites.props.accessibilityState.selected).toBe(true);
  // The selected star is filled; the label stays visible under each icon.
  expect(screen.getByText("★")).toBeTruthy();
  expect(screen.getByText("设置")).toBeTruthy();
  await fireEvent.press(favorites);
  expect(change).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  expect(change).toHaveBeenCalledWith("all");
});
