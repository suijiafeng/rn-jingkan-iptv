import {
  channelMonogram,
  channelTitle,
  displayGroups,
  filteredGroup,
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

test("the row caption leaves out the group the list is filtered to", () => {
  expect(displayGroups("央视;新闻")).toBe("央视、新闻");
  expect(displayGroups("央视;新闻", "央视")).toBe("新闻");
  expect(displayGroups("央视", "央视")).toBe("");
  expect(filteredGroup("all", "央视")).toBe("央视");
  expect(filteredGroup("all", "")).toBe(UNGROUPED);
  expect(filteredGroup("all", null)).toBeNull();
  expect(filteredGroup("favorites", "央视")).toBeNull();
});

test("monograms tell a channel family apart instead of repeating its prefix", () => {
  expect(channelMonogram("CCTV5")).toBe("5");
  expect(channelMonogram("CCTV5+")).toBe("5+");
  expect(channelMonogram("CCTV-15")).toBe("15");
  expect(channelMonogram("CCTV怀旧剧场")).toBe("怀");
  expect(channelMonogram("CGTN")).toBe("CG");
  expect(channelMonogram("湖南卫视")).toBe("湖");
  expect(channelMonogram("  ")).toBe("台");
});
