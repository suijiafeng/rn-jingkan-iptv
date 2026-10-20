/** @jest-environment node */
import { Repository } from "../src/data/repository";
import { parseM3U } from "../src/domain/m3u";
import {
  content,
  openTestRepository,
  TestDatabase,
} from "./support/repositoryTestKit";

let db: TestDatabase;
let repo: Repository;

beforeEach(async () => {
  ({ db, repo } = await openTestRepository());
});
afterEach(() => {
  db.native.close();
});

const playlist = content([
  { name: "翡翠台", url: "https://a.example.com/tvb", group: "香港" },
  { name: "明珠台", url: "https://a.example.com/pearl", group: "香港;英文" },
  { name: "CCTV-1", url: "https://a.example.com/cctv1", group: "央视" },
  {
    name: "凤凰中文",
    url: "https://a.example.com/phoenix",
    group: "香港",
    language: "zh",
  },
  {
    name: "BBC News",
    id: "BBCNews.uk@HD",
    url: "https://a.example.com/bbc",
    group: "央视",
  },
]);

async function importPlaylist() {
  return repo.importSource({
    name: "家里",
    kind: "file",
    location: "home.m3u",
    content: playlist,
    preview: await parseM3U(playlist),
  });
}
async function languagesByName() {
  const channels = await repo.listChannels({ includeVariants: true });
  return Object.fromEntries(
    channels.map((channel) => [channel.name, channel.languages]),
  );
}

test("playlist labels, then the lookup, then a group, then the source", async () => {
  const source = await importPlaylist();
  const bbc = (await repo.listChannels()).find(
    (channel) => channel.name === "BBC News",
  )!;
  await repo.saveLookedUpLanguages([
    { channelId: bbc.id, tvgId: "BBCNews.uk@HD", languages: ["en"] },
  ]);
  await repo.setSourceLanguages(source.id, {
    defaultLanguage: "zh",
    groups: { 香港: "yue", 英文: "en" },
  });
  expect(await languagesByName()).toEqual({
    翡翠台: ["yue"],
    // In two groups with a language each: both apply.
    明珠台: ["yue", "en"],
    "CCTV-1": ["zh"],
    凤凰中文: ["zh"],
    "BBC News": ["en"],
  });
  // Filtering and the facet menu use the same languages.
  expect(
    (await repo.listChannels({ language: "yue" }))
      .map((channel) => channel.name)
      .sort(),
  ).toEqual(["明珠台", "翡翠台"]);
  expect((await repo.listFacets()).languages).toEqual(
    expect.arrayContaining(["yue", "en", "zh"]),
  );
  expect(await repo.listChannels({ language: "" })).toEqual([]);
});

test("choices read back, replace whole, and refuse anything but one code", async () => {
  const source = await importPlaylist();
  expect(await repo.getSourceLanguages(source.id)).toEqual({
    defaultLanguage: "",
    groups: {},
  });
  expect(await repo.listSourceGroups(source.id)).toEqual([
    "香港",
    "央视",
    "英文",
  ]);
  await repo.setSourceLanguages(source.id, {
    defaultLanguage: "Chinese",
    groups: { 香港: "粤语", 央视: "" },
  });
  expect(await repo.getSourceLanguages(source.id)).toEqual({
    defaultLanguage: "zh",
    groups: { 香港: "yue" },
  });
  await repo.setSourceLanguages(source.id, {
    defaultLanguage: "",
    groups: {},
  });
  expect(await repo.getSourceLanguages(source.id)).toEqual({
    defaultLanguage: "",
    groups: {},
  });
  await expect(
    repo.setSourceLanguages(source.id, {
      defaultLanguage: "zh;en",
      groups: {},
    }),
  ).rejects.toThrow();
});

test("a switched-off source still lists its groups; deleting it drops its choices", async () => {
  const source = await importPlaylist();
  await repo.setSourceLanguages(source.id, {
    defaultLanguage: "zh",
    groups: { 香港: "yue" },
  });
  await repo.setSourceEnabled(source.id, false);
  expect(await repo.listSourceGroups(source.id)).toHaveLength(3);
  await repo.deleteSource(source.id);
  expect(await db.getAllAsync("SELECT * FROM source_group_languages")).toEqual(
    [],
  );
});

test("a source language never hides channels from the iptv-org lookup", async () => {
  const source = await importPlaylist();
  await repo.setSourceLanguages(source.id, {
    defaultLanguage: "zh",
    groups: {},
  });
  expect(await repo.listLanguageLookupTargets(source.id)).toEqual([
    { id: expect.any(String), tvgId: "BBCNews.uk@HD" },
  ]);
});

test("choices survive a refresh of the same list", async () => {
  const source = await importPlaylist();
  await repo.setSourceLanguages(source.id, {
    defaultLanguage: "",
    groups: { 央视: "zh" },
  });
  const token = await repo.beginRefresh(source.id);
  await repo.refreshSource(
    source.id,
    token.revision,
    await parseM3U(playlist),
    { generation: token.generation, content: playlist },
  );
  expect((await languagesByName())["CCTV-1"]).toEqual(["zh"]);
});
