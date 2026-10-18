import { act, renderHook } from "@testing-library/react-native";
import { useChannelFilters } from "../useChannelFilters";

test("each tab keeps its own filters; other tabs keep only their search", async () => {
  const { result } = await renderHook(() => useChannelFilters());
  await act(async () => {
    result.current.setSource("s1");
    result.current.setFacets({
      country: "CN",
      language: "zh",
      content: "新闻",
    });
    result.current.setSearch("央视");
  });
  await act(async () => result.current.switchTab("all", "favorites"));
  expect(result.current).toMatchObject({
    sourceId: "",
    group: null,
    language: null,
    search: "",
    query: "",
  });
  await act(async () => result.current.setSearch("体育"));
  await act(async () => result.current.switchTab("favorites", "all"));
  expect(result.current).toMatchObject({
    sourceId: "s1",
    group: "新闻",
    language: "zh",
    search: "央视",
    query: "央视",
  });
  await act(async () => result.current.switchTab("all", "favorites"));
  expect(result.current.search).toBe("体育");
});

test("forgetting a source clears it now and in remembered tabs", async () => {
  const { result } = await renderHook(() => useChannelFilters());
  await act(async () => {
    result.current.setSource("gone");
    result.current.setFacets({
      country: null,
      language: "en",
      content: "电影",
    });
  });
  await act(async () => result.current.switchTab("all", "recent"));
  await act(async () => result.current.forgetSource("gone"));
  await act(async () => result.current.switchTab("recent", "all"));
  expect(result.current).toMatchObject({
    sourceId: "",
    group: null,
    language: null,
  });
  await act(async () => {
    result.current.setSource("kept");
    result.current.forgetSource("gone");
  });
  expect(result.current.sourceId).toBe("kept");
});
