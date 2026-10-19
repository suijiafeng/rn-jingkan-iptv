import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FirstRunGuide } from "../FirstRunGuide";

test("the guide is one page that leads straight to adding a playlist", async () => {
  const onFinish = jest.fn();
  await render(<FirstRunGuide visible onFinish={onFinish} />);
  expect(screen.getByRole("header", { name: "静看 TV" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "从文件导入" }));
  expect(onFinish).toHaveBeenLastCalledWith("file");
  await fireEvent.press(screen.getByRole("button", { name: "添加节目单链接" }));
  expect(onFinish).toHaveBeenLastCalledWith("url");
});

test("choosing later finishes without opening a form", async () => {
  const onFinish = jest.fn();
  await render(<FirstRunGuide visible onFinish={onFinish} />);
  await fireEvent.press(screen.getByRole("button", { name: "稍后再说" }));
  expect(onFinish).toHaveBeenLastCalledWith(null);
});

test("reopened from settings, the guide has a top-left back instead", async () => {
  const onFinish = jest.fn();
  await render(<FirstRunGuide visible fromSettings onFinish={onFinish} />);
  expect(screen.queryByRole("button", { name: "稍后再说" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "返回" }));
  expect(onFinish).toHaveBeenLastCalledWith(null);
});
