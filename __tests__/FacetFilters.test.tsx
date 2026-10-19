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
  // No title or helper text inside the menu: only the options.
  expect(screen.queryByRole("header")).toBeNull();
  expect(screen.getByTestId("facet-filters-modal")).toBeTruthy();
  expect(
    screen.getByTestId("facet-filters-options").props.horizontal,
  ).toBeUndefined();
  await fireEvent.press(screen.getByRole("button", { name: "全部" }));
  expect(callbacks.onChange).toHaveBeenCalledWith(
    { country: "CN", language: "zh", content: null },
    "content",
  );
  expect(screen.queryByTestId("facet-filters-modal")).toBeNull();
  dismiss.mockRestore();
});

test("unmarked differs from all and manual country selection is recorded even when unchanged", async () => {
  const callbacks = props();
  await render(<FacetFilters {...callbacks} />);
  await fireEvent.press(
    screen.getByRole("button", { name: "国家/地区：全部" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "全部" }));
  expect(callbacks.onChange).toHaveBeenLastCalledWith(EMPTY_FACETS, "country");
  await fireEvent.press(
    screen.getByRole("button", { name: "国家/地区：全部" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "未标注" }));
  expect(callbacks.onChange).toHaveBeenLastCalledWith(
    { ...EMPTY_FACETS, country: "" },
    "country",
  );
});

test("back and backdrop dismiss the menu, which has no auto-detect entry", async () => {
  const callbacks = props();
  await render(<FacetFilters {...callbacks} countryHint="按设备地区推荐" />);
  await fireEvent.press(
    screen.getByRole("button", { name: "国家/地区：全部" }),
  );
  // The basis is a line of text atop the menu, never an option to tap.
  expect(screen.getByText("按设备地区推荐")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "按设备地区推荐" })).toBeNull();
  expect(screen.queryByText("自动识别")).toBeNull();
  await fireEvent(
    screen.getByTestId("facet-filters-native-modal"),
    "requestClose",
  );
  expect(screen.queryByTestId("facet-filters-modal")).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: "国家/地区：全部" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "关闭筛选菜单" }));
  expect(screen.queryByTestId("facet-filters-modal")).toBeNull();
  expect(callbacks.onChange).not.toHaveBeenCalled();
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
  await fireEvent.press(
    screen.getByRole("button", { name: "国家/地区：全部" }),
  );
  expect(screen.getByRole("button", { name: "未标注" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "关闭筛选菜单" }));
  await fireEvent.press(screen.getByRole("button", { name: "语言：全部" }));
  expect(screen.getByRole("button", { name: "全部" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "关闭筛选菜单" }));
  await fireEvent.press(screen.getByRole("button", { name: "内容：体育" }));
  await fireEvent.press(screen.getByRole("button", { name: "体育" }));
  expect(callbacks.onChange).not.toHaveBeenCalled();
  await ui.rerender(<FacetFilters {...callbacks} />);
});

test("content as tabs switches with one tap and shows unlabeled as 未分组", async () => {
  const callbacks = props();
  await render(
    <FacetFilters
      {...callbacks}
      contentAsTabs
      options={{ countries: [], languages: [], contents: ["体育", ""] }}
    />,
  );
  expect(screen.queryByRole("button", { name: /^内容：/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "体育" }));
  expect(callbacks.onChange).toHaveBeenLastCalledWith(
    { ...EMPTY_FACETS, content: "体育" },
    "content",
  );
  await fireEvent.press(screen.getByRole("button", { name: "未分组" }));
  expect(callbacks.onChange).toHaveBeenLastCalledWith(
    { ...EMPTY_FACETS, content: "" },
    "content",
  );
});
