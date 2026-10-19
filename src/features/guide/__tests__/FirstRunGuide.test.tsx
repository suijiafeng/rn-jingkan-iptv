import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FirstRunGuide } from "../FirstRunGuide";

const next = () =>
  fireEvent.press(screen.getByRole("button", { name: "下一步" }));

test("the guide walks through its pages and ends with ways to add a playlist", async () => {
  const onFinish = jest.fn();
  await render(<FirstRunGuide visible onFinish={onFinish} />);
  expect(screen.getByText("欢迎使用静看 TV")).toBeTruthy();
  expect(screen.getByLabelText("第 1 页，共 4 页")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "上一步" })).toBeNull();
  await next();
  expect(screen.getByText("添加你的节目单")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "上一步" }));
  expect(screen.getByText("欢迎使用静看 TV")).toBeTruthy();
  await next();
  await next();
  await next();
  expect(screen.getByText("资料只在这台手机")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
  expect(screen.queryByRole("button", { name: "跳过使用指引" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "从文件导入" }));
  expect(onFinish).toHaveBeenCalledWith("file");
});

test("skipping or choosing later finishes without opening a form", async () => {
  const onFinish = jest.fn();
  await render(<FirstRunGuide visible onFinish={onFinish} />);
  await fireEvent.press(screen.getByRole("button", { name: "跳过使用指引" }));
  expect(onFinish).toHaveBeenLastCalledWith(null);
  // Finishing starts the next showing from the first page.
  expect(screen.getByText("欢迎使用静看 TV")).toBeTruthy();
  for (let page = 0; page < 3; page++) await next();
  await fireEvent.press(screen.getByRole("button", { name: "稍后再说" }));
  expect(onFinish).toHaveBeenLastCalledWith(null);
  for (let page = 0; page < 3; page++) await next();
  await fireEvent.press(screen.getByRole("button", { name: "添加节目单链接" }));
  expect(onFinish).toHaveBeenLastCalledWith("url");
});
