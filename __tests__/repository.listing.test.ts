/** @jest-environment node */
import { Repository } from "../src/data/repository";
import { parseM3U } from "../src/domain/m3u";
import type { Source } from "../src/domain/types";
import {
  content,
  importInitialInto,
  openTestRepository,
  TestDatabase,
} from "./support/repositoryTestKit";

let db: TestDatabase;
let repo: Repository;
async function importInitial(): Promise<Source> {
  return importInitialInto(repo);
}

beforeEach(async () => {
  ({ db, repo } = await openTestRepository());
});
afterEach(() => {
  db.native.close();
});

describe("SQLite repository with real SQLite", () => {
  it("collapses reliable duplicate channels to the lowest declared quality and retains every source", async () => {
    const playlist = content([
      {
        name: "CCTV-1 高清",
        id: "CCTV1.cn@HD",
        url: "https://a.example.com/hd",
      },
      {
        name: "CCTV-1 标清",
        id: "CCTV1.cn@SD",
        url: "https://a.example.com/sd",
      },
    ]);
    const source = await repo.importSource({
      name: "主列表",
      kind: "file",
      location: "one.m3u",
      content: playlist,
      preview: await parseM3U(playlist),
    });
    const shown = await repo.listChannels();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      sourceId: source.id,
      qualityLabel: "标清",
      qualityRank: 576,
    });
    expect(await repo.countChannels()).toBe(1);
    const alternatives = await repo.listChannelSources(shown[0].groupKey!);
    expect(alternatives.map((item) => item.qualityLabel)).toEqual([
      "标清",
      "高清",
    ]);
    expect(shown[0]).not.toHaveProperty("groupRow");
    expect(shown[0]).not.toHaveProperty("favoriteCreatedAt");
    expect(shown[0]).not.toHaveProperty("sourceCreatedAt");
  });

  it("keeps inactive variants out of favorites and falls back to an active source", async () => {
    const first = content([
      {
        name: "CCTV-1 标清",
        id: "CCTV1.cn@SD",
        url: "https://a.example.com/sd",
      },
      {
        name: "CCTV-1 高清",
        id: "CCTV1.cn@HD",
        url: "https://a.example.com/hd",
      },
    ]);
    const source = await repo.importSource({
      name: "主列表",
      kind: "file",
      location: "one.m3u",
      content: first,
      preview: await parseM3U(first),
    });
    const [sd] = await repo.listChannels();
    await repo.toggleFavorite(sd.id);
    const second = content([
      {
        name: "CCTV-1 高清",
        id: "CCTV1.cn@HD",
        url: "https://a.example.com/hd",
      },
    ]);
    await repo.refreshSource(
      source.id,
      source.revision,
      await parseM3U(second),
    );

    expect(await repo.listFavorites()).toMatchObject([
      { active: true, qualityLabel: "高清" },
    ]);
    expect(await repo.listChannelSources(sd.groupKey!)).toMatchObject([
      { active: true, qualityLabel: "高清" },
    ]);
  });

  it("keeps a disabled source stored while excluding it from browsing and playback", async () => {
    const source = await importInitial();
    const channels = await repo.listChannels({ includeVariants: true });
    await repo.toggleFavorite(channels[0].id);
    await repo.recordRecent(channels[0].id);

    await repo.setSourceEnabled(source.id, false);

    expect(await repo.listSources()).toMatchObject([
      { id: source.id, enabled: false, channelCount: 3 },
    ]);
    expect(await repo.listChannels()).toEqual([]);
    expect(await repo.listFavorites()).toEqual([]);
    expect(await repo.listRecent()).toEqual([]);
    expect(await repo.listChannelSources(channels[0].groupKey!)).toEqual([]);
    expect(await repo.getChannel(channels[0].id)).toMatchObject({
      active: false,
      favorite: true,
    });

    await repo.setSourceEnabled(source.id, true);
    expect(await repo.listSources()).toMatchObject([{ enabled: true }]);
    expect(await repo.listChannels()).toHaveLength(3);
    expect(await repo.listFavorites()).toHaveLength(1);
    expect(await repo.listRecent()).toHaveLength(1);
  });

  it("remembers the played source and otherwise prefers an unlabelled main source", async () => {
    const playlist = content([
      {
        name: "CCTV-1 标清",
        id: "CCTV1.cn@SD",
        url: "https://a.example.com/sd",
      },
      {
        name: "CCTV-1 主源",
        id: "CCTV1.cn",
        url: "https://a.example.com/main",
      },
      {
        name: "CCTV-1 高清",
        id: "CCTV1.cn@HD",
        url: "https://a.example.com/hd",
      },
    ]);
    await repo.importSource({
      name: "主列表",
      kind: "file",
      location: "one.m3u",
      content: playlist,
      preview: await parseM3U(playlist),
    });
    const [shown] = await repo.listChannels();
    expect(shown.qualityLabel).toBe("标清");
    let alternatives = await repo.listChannelSources(shown.groupKey!);
    expect(alternatives.map((item) => item.name)).toEqual([
      "CCTV-1 主源",
      "CCTV-1 标清",
      "CCTV-1 高清",
    ]);

    const hd = alternatives.find((item) => item.qualityLabel === "高清")!;
    await repo.recordRecent(hd.id);
    expect(await repo.listRecent()).toMatchObject([{ id: hd.id }]);
    alternatives = await repo.listChannelSources(shown.groupKey!);
    expect(alternatives[0].id).toBe(hd.id);
  });

  it("does not add a favorite through an inactive group with no playable row", async () => {
    const source = await importInitial();
    const [channel] = await repo.listChannels();
    await repo.refreshSource(
      source.id,
      source.revision,
      await parseM3U(
        content([
          { name: "其他", id: "other", url: "https://a.example.com/other" },
        ]),
      ),
    );
    await expect(repo.toggleFavorite(channel.id)).rejects.toMatchObject({
      code: "channel_missing",
    });
    expect(await repo.listFavorites()).toEqual([]);
  });

  it("imports and filters by source, group and literal search", async () => {
    const source = await importInitial();
    expect(await repo.listGroups(source.id)).toEqual(["体育", "新闻"]);
    expect(
      await repo.listChannels({
        search: "  cctv ",
        groupName: "体育",
        sourceId: source.id,
      }),
    ).toMatchObject([{ name: "CCTV Sports" }]);
    expect(await repo.listChannels({ search: "100%_" })).toHaveLength(1);
    expect(await repo.listChannels({ search: "%" })).toHaveLength(1);
    expect(await repo.listChannels({ search: "' OR 1=1 --" })).toHaveLength(0);
  });

  it("pages a list in the same order as the full read and counts the same filter", async () => {
    const many = content(
      Array.from({ length: 25 }, (_unused, index) => ({
        name: `台${index}`,
        id: `p${index}`,
        url: `https://a.example.com/p${index}`,
        group: index % 2 ? "体育" : "新闻",
      })),
    );
    await repo.importSource({
      name: "分页",
      kind: "file",
      location: "page.m3u",
      content: many,
      preview: await parseM3U(many),
    });
    const full = await repo.listChannels();
    const first = await repo.listChannels({ limit: 10 });
    const rest = await repo.listChannels({ offset: 10 });
    expect([...first, ...rest].map((channel) => channel.id)).toEqual(
      full.map((channel) => channel.id),
    );
    expect(await repo.countChannels()).toBe(25);
    const sports = { groupName: "体育", search: "台1" };
    const sportsRows = await repo.listChannels(sports);
    expect(sportsRows.length).toBeGreaterThan(0);
    expect(await repo.countChannels(sports)).toBe(sportsRows.length);
    expect(await repo.listChannels({ ...sports, limit: 2 })).toEqual(
      sportsRows.slice(0, 2),
    );
    await repo.toggleFavorite(full[3].id);
    expect(await repo.countChannels({ mode: "favorites" })).toBe(1);
    expect(await repo.listChannels({ mode: "favorites", offset: 1 })).toEqual(
      [],
    );
  });

  it("filters by one member of a multi-group channel and treats wildcards literally", async () => {
    const text = content([
      { name: "甲", url: "https://a.example.com/a", group: "News;Kids" },
      { name: "乙", url: "https://a.example.com/b", group: "Kids" },
      { name: "丙", url: "https://a.example.com/c", group: "100%_x" },
    ]);
    await repo.importSource({
      name: "多分组",
      kind: "file",
      location: "g.m3u",
      content: text,
      preview: await parseM3U(text),
    });
    expect(
      (await repo.listChannels({ groupName: "少儿" })).map(
        (channel) => channel.name,
      ),
    ).toEqual(["甲", "乙"]);
    expect(
      (await repo.listChannels({ groupName: "新闻" })).map(
        (channel) => channel.name,
      ),
    ).toEqual(["甲"]);
    expect(
      (await repo.listChannels({ groupName: "100%_x" })).map(
        (channel) => channel.name,
      ),
    ).toEqual(["丙"]);
    expect(await repo.listChannels({ groupName: "100" })).toEqual([]);
  });

  it("combines source/country/language/content/search and preserves whole-token filters", async () => {
    const text = content([
      {
        name: "双语新闻",
        url: "https://a.example.com/1",
        country: "CN;US",
        language: "zh;en",
        group: "News;Kids",
      },
      {
        name: "美国新闻",
        url: "https://a.example.com/2",
        country: "US",
        language: "en-US",
        group: "News",
      },
      { name: "未标注", url: "https://a.example.com/3", group: "" },
    ]);
    const source = await repo.importSource({
      name: "维度",
      kind: "url",
      location: "https://a.example.com/list",
      preview: await parseM3U(text),
    });
    const other = await repo.importSource({
      name: "其他",
      kind: "file",
      location: "other.m3u",
      content: text,
      preview: await parseM3U(text),
    });
    expect(
      await repo.listChannels({
        sourceId: source.id,
        country: "US",
        language: "en",
        groupName: "少儿",
        search: "新闻",
      }),
    ).toMatchObject([{ name: "双语新闻" }]);
    expect(
      await repo.listChannels({
        sourceId: source.id,
        country: "US",
        language: "en",
      }),
    ).toHaveLength(1);
    expect(
      await repo.listChannels({ sourceId: source.id, country: "U" }),
    ).toEqual([]);
    expect(
      await repo.listChannels({ sourceId: source.id, language: "en-US" }),
    ).toMatchObject([{ name: "美国新闻" }]);
    expect(
      await repo.listChannels({
        sourceId: source.id,
        country: "",
        language: "",
        groupName: "",
      }),
    ).toMatchObject([{ name: "未标注", countries: [], languages: [] }]);
    // Paging and counts must retain every facet predicate, including unmarked.
    for (const filters of [
      {
        sourceId: source.id,
        country: "US",
        language: "en",
        groupName: "少儿",
        search: "新闻",
      },
      { sourceId: source.id, country: "", language: "", groupName: "" },
      { country: "CN" },
    ]) {
      const matches = await repo.listChannels(filters);
      expect(await repo.countChannels(filters)).toBe(matches.length);
      expect(await repo.listChannels({ ...filters, limit: 1 })).toEqual(
        matches.slice(0, 1),
      );
      expect(await repo.listChannels({ ...filters, offset: 1 })).toEqual(
        matches.slice(1),
      );
    }
    for (const escaped of ["%", "_", "' OR 1=1 --", "US;CN", "en\\"]) {
      expect(await repo.listChannels({ country: escaped })).toEqual([]);
      expect(await repo.listChannels({ language: escaped })).toEqual([]);
    }
    const facets = await repo.listFacets(source.id);
    expect(facets.countries).toEqual(expect.arrayContaining(["CN", "US", ""]));
    expect(facets.languages).toEqual(
      expect.arrayContaining(["zh", "en", "en-US", ""]),
    );
    expect(facets.contents).toEqual(
      expect.arrayContaining(["新闻", "少儿", ""]),
    );
    expect(await repo.listFacets("missing-source")).toEqual({
      countries: [],
      languages: [],
      contents: [],
    });
    const token = await repo.beginRefresh(source.id);
    await repo.refreshSource(
      source.id,
      token.revision,
      await parseM3U(
        content([
          {
            name: "日本",
            id: "jp",
            url: "https://a.example.com/jp",
            country: "JP",
            language: "ja",
          },
        ]),
      ),
    );
    expect((await repo.listFacets(source.id)).countries).toEqual(["JP"]);
    expect((await repo.listFacets(other.id)).countries).toEqual(
      facets.countries,
    );
    expect((await repo.listFacets()).countries).toEqual(
      expect.arrayContaining(["CN", "US", "JP", ""]),
    );
  });
});

it("lists unreachable channels last while unchecked and reachable keep their order", async () => {
  const text = content([
    { name: "一", url: "https://a.example.com/1" },
    { name: "二", url: "https://a.example.com/2" },
    { name: "三", url: "https://a.example.com/3" },
    { name: "四", url: "https://a.example.com/4" },
  ]);
  await repo.importSource({
    name: "排序",
    kind: "file",
    location: "o.m3u",
    content: text,
    preview: await parseM3U(text),
  });
  const [one, two, three] = await repo.listChannels();
  await repo.saveCheckResults([
    { channelId: one.id, streamUrl: one.streamUrl, ok: false },
    { channelId: three.id, streamUrl: three.streamUrl, ok: true },
  ]);
  expect((await repo.listChannels()).map((channel) => channel.name)).toEqual([
    "二",
    "三",
    "四",
    "一",
  ]);
  await repo.toggleFavorite(one.id);
  await repo.toggleFavorite(two.id);
  expect(
    (await repo.listChannels({ mode: "favorites" })).map(
      (channel) => channel.name,
    ),
  ).toEqual(["二", "一"]);
});
