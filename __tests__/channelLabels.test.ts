import {
  channelTitle,
  displayGroups,
  normalizeGroups,
  splitGroups,
  UNGROUPED,
} from "../src/domain/channelLabels";

test("translates iptv-org categories, splits ';' and drops Undefined", () => {
  expect(normalizeGroups("Culture;Documentary;Travel")).toBe(
    "文化;纪录片;旅游",
  );
  expect(normalizeGroups(" news ； KIDS ;News")).toBe("新闻;少儿");
  expect(normalizeGroups("Undefined")).toBe(UNGROUPED);
  expect(normalizeGroups("")).toBe(UNGROUPED);
  expect(normalizeGroups(undefined)).toBe(UNGROUPED);
  expect(normalizeGroups("央视;Undefined")).toBe("央视");
  expect(normalizeGroups("未分组")).toBe(UNGROUPED);
});

test("splits and displays stored group lists", () => {
  expect(splitGroups("文化;纪录片")).toEqual(["文化", "纪录片"]);
  expect(splitGroups("")).toEqual([UNGROUPED]);
  expect(displayGroups("文化;纪录片")).toBe("文化、纪录片");
});

test("separates trailing bracket markers from the channel title", () => {
  expect(channelTitle("Berita RTM [Geo-blocked]")).toEqual({
    title: "Berita RTM",
    tags: ["地区限制"],
  });
  expect(channelTitle("CCTV+ 1 (600p) [Not 24/7] [Geo-blocked]")).toEqual({
    title: "CCTV+ 1 (600p)",
    tags: ["非全天", "地区限制"],
  });
  expect(channelTitle("[Test]")).toEqual({ title: "[Test]", tags: [] });
  expect(channelTitle("CCTV-1 (720p)")).toEqual({
    title: "CCTV-1 (720p)",
    tags: [],
  });
});
