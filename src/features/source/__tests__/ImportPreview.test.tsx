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
      fillLanguages
      onFillLanguages={() => {}}
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
      fillLanguages
      onFillLanguages={() => {}}
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

test("unlabelled iptv-org channels get a language switch that says it goes online", async () => {
  const preview = previewOf(3);
  preview.channels[0] = { ...preview.channels[0], tvgId: "CCTV1.cn@SD" };
  preview.channels[1] = {
    ...preview.channels[1],
    tvgId: "BBCNews.uk@HD",
    languages: ["en"],
  };
  const toggle = jest.fn();
  await render(
    <ImportPreviewBody
      preview={preview}
      header={null}
      busy={false}
      fillLanguages
      onFillLanguages={toggle}
      onSave={() => {}}
      onBack={() => {}}
    />,
  );
  // Its title says it goes online and roughly how much it downloads.
  expect(screen.getByText(/联网约 8 MB/)).toBeTruthy();
  const languageSwitch = screen.getByLabelText("导入后自动补全语言");
  expect(languageSwitch.props.value).toBe(true);
  await fireEvent(languageSwitch, "valueChange", false);
  expect(toggle).toHaveBeenCalledWith(false);
});

test("no switch when nothing needs a language", async () => {
  await render(
    <ImportPreviewBody
      preview={previewOf(3)}
      header={null}
      busy={false}
      fillLanguages
      onFillLanguages={() => {}}
      onSave={() => {}}
      onBack={() => {}}
    />,
  );
  expect(screen.queryByLabelText("导入后自动补全语言")).toBeNull();
});
