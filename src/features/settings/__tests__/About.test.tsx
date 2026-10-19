import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { About } from "../About";
import { RISK } from "../../common/confirm";

test("about opens on folded sections; each unfolds on its own", async () => {
  await render(<About />);
  await fireEvent.press(screen.getByText("关于静看 TV"));
  expect(screen.getByText("安静地看，资料自己保管。")).toBeTruthy();
  expect(screen.queryByText(RISK)).toBeNull();
  const risk = screen.getByRole("button", { name: "联网说明" });
  expect(risk.props.accessibilityState).toMatchObject({ expanded: false });
  await fireEvent.press(risk);
  expect(screen.getByText(RISK)).toBeTruthy();
  expect(screen.queryByText(/THIRD_PARTY_NOTICES/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "联网说明" }));
  expect(screen.queryByText(RISK)).toBeNull();
});

test("about closes from a pinned top-left back", async () => {
  await render(<About />);
  await fireEvent.press(screen.getByText("关于静看 TV"));
  expect(screen.queryByRole("button", { name: "返回设置" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "返回" }));
  expect(screen.queryByText("安静地看，资料自己保管。")).toBeNull();
});
