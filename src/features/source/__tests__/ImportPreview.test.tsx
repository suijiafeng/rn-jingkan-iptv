import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ImportPreview, ParsedChannel } from "../../../domain/types";
import { ImportPreviewBody } from "../ImportPreview";

const channel = (index: number): ParsedChannel => ({
  identityKey: `url:https://example.test/${index}.m3u8`,
  name: `频道 ${index}`,
  groupName: "新闻",
  tvgId: null,
  logoUrl: null,
  countries: [],
  languages: [],
  streamUrl: `https://example.test/${index}.m3u8`,
  qualityLabel: index === 1 ? "1080p" : null,
  qualityRank: index === 1 ? 1080 : null,
  sortIndex: index,
});

function previewOf(count: number): ImportPreview {
  return {
    channels: Array.from({ length: count }, (_unused, index) => channel(index)),
    stats: {
      valid: count,
      duplicates: 0,
      ignored: 0,
      total: count,
      http: 0,
      bytes: 0,
      lines: 0,
    },
    issueCounts: {},
    issues: [],
  } as ImportPreview;
}

test("the preview lists every channel, not the first five", async () => {
  await render(
    <ImportPreviewBody
      preview={previewOf(12)}
      header={null}
      busy={false}
      onSave={() => {}}
      onBack={() => {}}
    />,
  );
  expect(screen.getByText("频道 0")).toBeTruthy();
  expect(screen.getByText("频道 11")).toBeTruthy();
  expect(screen.getByText("1080p")).toBeTruthy();
  expect(screen.queryByText(/还有/)).toBeNull();
});

test("a long list stays lazy and importing never needs scrolling to", async () => {
  const save = jest.fn();
  await render(
    <ImportPreviewBody
      preview={previewOf(5000)}
      header={null}
      busy={false}
      onSave={save}
      onBack={() => {}}
    />,
  );
  // Only the first screens are rendered; the rest come in as it scrolls.
  expect(screen.queryByText("频道 4999")).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: "导入 5000 个频道" }),
  );
  expect(save).toHaveBeenCalledTimes(1);
});
