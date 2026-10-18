import React from "react";
import { Keyboard } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FacetFilters } from "../src/components/FacetFilters";
import { EMPTY_FACETS } from "../src/domain/channelFacets";

function props() {
  return {
    options: {
      countries: ["CN", "US", ""],
      languages: ["zh", "en", ""],
      contents: ["新闻", "体育", ""],
    },
    selected: EMPTY_FACETS,
    onChange: jest.fn(),
  };
}

test("three compact dimensions open one scrollable menu, and selection clears only that dimension", async () => {
  const callbacks = props();
  const dismiss = jest.spyOn(Keyboard, "dismiss");
  await render(
    <FacetFilters
      {...callbacks}
      selected={{ country: "CN", language: "zh", content: "体育" }}
    />,
  );
  expect(screen.getAllByRole("button")).toHaveLength(3);
  await fireEvent.press(screen.getByRole("button", { name: "内容：体育" }));
  expect(dismiss).toHaveBeenCalled();
  expect(screen.getByRole("header", { name: "选择内容" })).toBeTruthy();
  expect(
    screen.getByTestId("facet-filters-options").props.horizontal,
  ).toBeUndefined();
  await fireEvent.press(screen.getByRole("button", { name: "全部" }));
  expect(callbacks.onChange).toHaveBeenCalledWith(
    { country: "CN", language: "zh", content: null },
    "content",
  );
  expect(screen.queryByRole("header", { name: "选择内容" })).toBeNull();
  dismiss.mockRestore();
});

test("unmarked differs from all and manual country selection is recorded even when unchanged", async () => {
  const callbacks = props();
  await render(<FacetFilters {...callbacks} />);
  await fireEvent.press(screen.getByRole("button", { name: "国别：全部" }));
  await fireEvent.press(screen.getByRole("button", { name: "全部" }));
  expect(callbacks.onChange).toHaveBeenLastCalledWith(EMPTY_FACETS, "country");
  await fireEvent.press(screen.getByRole("button", { name: "国别：全部" }));
  await fireEvent.press(screen.getByRole("button", { name: "未标注" }));
  expect(callbacks.onChange).toHaveBeenLastCalledWith(
    { ...EMPTY_FACETS, country: "" },
    "country",
  );
});

test("back and backdrop dismiss the menu and auto detection has one separate entry", async () => {
  const callbacks = props();
  const auto = jest.fn();
  await render(
    <FacetFilters
      {...callbacks}
      onAutoCountry={auto}
      countryHint="按设备地区推荐"
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "国别：全部" }));
  expect(screen.getByText("按设备地区推荐")).toBeTruthy();
  await fireEvent(
    screen.getByTestId("facet-filters-native-modal"),
    "requestClose",
  );
  expect(screen.queryByTestId("facet-filters-modal")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "国别：全部" }));
  await fireEvent.press(screen.getByRole("button", { name: "关闭筛选菜单" }));
  expect(screen.queryByTestId("facet-filters-modal")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "国别：全部" }));
  await fireEvent.press(screen.getByRole("button", { name: "自动识别国别" }));
  expect(auto).toHaveBeenCalledTimes(1);
  expect(callbacks.onChange).not.toHaveBeenCalled();
  expect(screen.queryByTestId("facet-filters-modal")).toBeNull();
});

test("missing metadata is explicit and unchanged non-country values do not trigger redundant changes", async () => {
  const callbacks = props();
  const ui = await render(
    <FacetFilters
      {...callbacks}
      options={{ countries: [""], languages: [], contents: ["体育"] }}
      selected={{ ...EMPTY_FACETS, content: "体育" }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "国别：全部" }));
  expect(
    screen.getByText("节目单未提供国别标注，可选择全部或未标注。"),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "关闭筛选菜单" }));
  await fireEvent.press(screen.getByRole("button", { name: "语言：全部" }));
  expect(screen.getByText("当前来源暂无语言选项。")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "关闭筛选菜单" }));
  await fireEvent.press(screen.getByRole("button", { name: "内容：体育" }));
  await fireEvent.press(screen.getByRole("button", { name: "体育" }));
  expect(callbacks.onChange).not.toHaveBeenCalled();
  await ui.rerender(
    <FacetFilters {...callbacks} onAutoCountry={jest.fn()} autoCountryBusy />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "国别：全部" }));
  expect(screen.getByRole("button", { name: "自动识别国别" })).toBeDisabled();
});
