import React from "react";
import { render, screen } from "@testing-library/react-native";
import { SourceList } from "../SourceList";
import { first, second } from "./support/playerTestKit";

test("an unreachable source says when it was tested and that picking it retries", async () => {
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  const stale = {
    ...second,
    checkStatus: "unreachable" as const,
    checkedAt: yesterday,
  };
  await render(
    <SourceList current={first} sources={[first, stale]} onSelect={() => {}} />,
  );
  expect(screen.getByText("昨天测试未连通 · 点选可再试")).toBeTruthy();
  expect(screen.queryByText(/检测/)).toBeNull();
});
