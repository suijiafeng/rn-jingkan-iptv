import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { NetworkConsentDialog } from "../NetworkConsentDialog";
import { RISK } from "../confirm";

test("consent shows three short points and folds the full text one tap away", async () => {
  const answer = jest.fn();
  await render(
    <NetworkConsentDialog visible cellular={false} onAnswer={answer} />,
  );
  expect(screen.getByText("来源服务器会看到你的 IP")).toBeTruthy();
  expect(screen.queryByText(/移动数据/)).toBeNull();
  expect(screen.queryByText(RISK)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "完整说明 ›" }));
  expect(screen.getByText(RISK)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "不用了" }));
  expect(answer).toHaveBeenLastCalledWith(false);
});

test("on mobile data the same consent names the data use", async () => {
  const answer = jest.fn();
  await render(<NetworkConsentDialog visible cellular onAnswer={answer} />);
  expect(screen.getByText(/可能在用移动数据/)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "允许" }));
  expect(answer).toHaveBeenLastCalledWith(true);
});
