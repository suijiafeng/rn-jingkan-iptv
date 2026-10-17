import React from "react";
import { ScrollView } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { GroupTabs } from "../src/components/GroupTabs";

test("all is the first category and repeated category taps retain the selected filter", async () => {
  const change = jest.fn();
  const ui = await render(
    <GroupTabs
      groups={["新闻", "体育", "未分组"]}
      selected="体育"
      onChange={change}
    />,
  );
  expect(screen.queryByRole("button", { name: "全部分组" })).toBeNull();
  expect(screen.getAllByRole("button")[0].props.accessibilityLabel).toBe(
    "全部",
  );
  expect(screen.getByTestId("group-tabs").props.horizontal).toBe(true);
  expect(
    screen.getByRole("button", { name: "体育" }).props.accessibilityState
      .selected,
  ).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "体育" }));
  expect(change).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "全部" }));
  expect(change).toHaveBeenLastCalledWith(null);
  await fireEvent.press(screen.getByRole("button", { name: "新闻" }));
  expect(change).toHaveBeenLastCalledWith("新闻");
  expect(screen.getByRole("button", { name: "未分组" })).toBeTruthy();
  await ui.rerender(
    <GroupTabs
      groups={["新闻", "体育", "未分组"]}
      selected={null}
      onChange={change}
    />,
  );
  expect(
    screen.getByRole("button", { name: "全部" }).props.accessibilityState
      .selected,
  ).toBe(true);
  change.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "全部" }));
  expect(change).not.toHaveBeenCalled();
});

test("scope all is distinct from a real group of the same name and recent remains a real group", async () => {
  const change = jest.fn();
  const ui = await render(
    <GroupTabs groups={["全部", "最近"]} selected="全部" onChange={change} />,
  );
  const buttons = screen.getAllByRole("button");
  expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([
    "全部",
    "全部（分组）",
    "最近",
  ]);
  expect(buttons[1].props.accessibilityState.selected).toBe(true);
  expect(buttons[0].props.accessibilityState.selected).toBe(false);
  await fireEvent.press(buttons[0]);
  expect(change).toHaveBeenLastCalledWith(null);
  await ui.rerender(
    <GroupTabs groups={["全部", "最近"]} selected={null} onChange={change} />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "全部（分组）" }));
  expect(change).toHaveBeenLastCalledWith("全部");
  await fireEvent.press(screen.getByRole("button", { name: "最近" }));
  expect(change).toHaveBeenLastCalledWith("最近");
  await ui.rerender(
    <GroupTabs groups={[]} selected={null} onChange={change} />,
  );
  expect(screen.queryByTestId("group-tabs")).toBeNull();
});

test("restored offscreen groups are revealed in either direction without fighting a manual scroll", async () => {
  const scroll = jest
    .spyOn(ScrollView.prototype, "scrollTo")
    .mockImplementation(() => {});
  const change = jest.fn();
  const groups = ["新闻", "体育", "电影"];
  try {
    const ui = await render(
      <GroupTabs groups={groups} selected="电影" onChange={change} />,
    );
    await fireEvent(screen.getByTestId("group-tabs"), "layout", {
      nativeEvent: { layout: { width: 100 } },
    });
    await fireEvent(
      screen.getByTestId("group-tabs"),
      "contentSizeChange",
      300,
      48,
    );
    await fireEvent(screen.getByTestId("group-tabs-all"), "layout", {
      nativeEvent: { layout: { x: 0, width: 60 } },
    });
    await fireEvent(screen.getByTestId("group-tabs-item-0"), "layout", {
      nativeEvent: { layout: { x: 70, width: 60 } },
    });
    await fireEvent(screen.getByTestId("group-tabs-item-2"), "layout", {
      nativeEvent: { layout: { x: 200, width: 70 } },
    });
    expect(scroll).toHaveBeenLastCalledWith({ x: 170, animated: false });
    scroll.mockClear();
    await fireEvent.scroll(screen.getByTestId("group-tabs"), {
      nativeEvent: { contentOffset: { x: 80, y: 0 } },
    });
    await ui.rerender(
      <GroupTabs groups={[...groups]} selected="电影" onChange={change} />,
    );
    expect(scroll).not.toHaveBeenCalled();
    await ui.rerender(
      <GroupTabs groups={groups} selected="新闻" onChange={change} />,
    );
    expect(scroll).toHaveBeenLastCalledWith({ x: 70, animated: false });
    await fireEvent.scroll(screen.getByTestId("group-tabs"), {
      nativeEvent: { contentOffset: { x: 150, y: 0 } },
    });
    scroll.mockClear();
    await ui.rerender(
      <GroupTabs groups={groups} selected={null} onChange={change} />,
    );
    expect(scroll).toHaveBeenLastCalledWith({ x: 0, animated: false });
  } finally {
    scroll.mockRestore();
  }
});

test("a viewport resize keeps a wide selected group reachable", async () => {
  const scroll = jest
    .spyOn(ScrollView.prototype, "scrollTo")
    .mockImplementation(() => {});
  try {
    await render(
      <GroupTabs
        groups={["新闻", "地方特色频道"]}
        selected="地方特色频道"
        onChange={() => {}}
      />,
    );
    const strip = screen.getByTestId("group-tabs");
    await fireEvent(strip, "layout", {
      nativeEvent: { layout: { width: 120 } },
    });
    await fireEvent(strip, "contentSizeChange", 260, 48);
    await fireEvent(screen.getByTestId("group-tabs-item-1"), "layout", {
      nativeEvent: { layout: { x: 160, width: 100 } },
    });
    expect(scroll).toHaveBeenLastCalledWith({ x: 140, animated: false });
    await fireEvent(strip, "layout", {
      nativeEvent: { layout: { width: 80 } },
    });
    expect(scroll).toHaveBeenLastCalledWith({ x: 160, animated: false });
  } finally {
    scroll.mockRestore();
  }
});
