/** @jest-environment node */
import { createRepository, type Repository } from "../src/data/repository";
import { parseM3U } from "../src/domain/m3u";
import {
  content,
  openTestRepository,
  type TestDatabase,
} from "./support/repositoryTestKit";

let repo: Repository;
let db: TestDatabase;
const url = "https://example.com/shared.m3u8";
async function add(name: string, streamUrl = url) {
  const text = content([{ name, url: streamUrl, id: name }]);
  return repo.importSource({
    name,
    kind: "file",
    location: `${name}.m3u`,
    content: text,
    preview: await parseM3U(text),
  });
}
beforeEach(async () => {
  ({ repo, db } = await openTestRepository());
});
afterEach(() => db.native.close());

test("all rows with the same complete address share a persisted result, unrelated addresses do not", async () => {
  await add("a");
  await add("b");
  await add("other", "https://example.com/other");
  const [first] = await repo.listChannels({ includeVariants: true });
  await repo.saveCheckResults([
    { channelId: first.id, streamUrl: url, ok: false },
  ]);
  const rows = await repo.listChannels({ includeVariants: true });
  expect(
    rows.filter((row) => row.streamUrl === url).map((row) => row.checkStatus),
  ).toEqual(["unreachable", "unreachable"]);
  expect(rows.find((row) => row.streamUrl !== url)?.checkStatus).toBeNull();
  expect(await repo.getCheckResults([url, url])).toHaveLength(1);
});

test("new sources inherit existing results and deleting the original source does not lose them", async () => {
  const firstSource = await add("a");
  const [first] = await repo.listChannels();
  await repo.saveCheckResults([
    { channelId: first.id, streamUrl: url, ok: true },
  ]);
  const secondSource = await add("b");
  const [second] = await repo.listChannels({ sourceId: secondSource.id });
  expect(second.checkStatus).toBe("ok");
  const stamp = second.checkedAt;
  await repo.deleteSource(firstSource.id);
  const reopened = await createRepository(db);
  expect(await reopened.getCheckResults([url])).toEqual([
    { streamUrl: url, checkStatus: "ok", checkedAt: stamp },
  ]);
  await reopened.clearAll();
  expect(await reopened.getCheckResults([url])).toEqual([]);
});

test("v7 migration reconciles conflicting rows using the latest URL result and can reopen repeatedly", async () => {
  await add("a");
  await add("b");
  const [alpha, beta] = await repo.listChannels({ includeVariants: true });
  await db.runAsync(
    "UPDATE channels SET checkStatus = 'ok', checkedAt = 10 WHERE id = ?",
    [alpha.id],
  );
  await db.runAsync(
    "UPDATE channels SET checkStatus = 'unreachable', checkedAt = 20 WHERE id = ?",
    [beta.id],
  );
  await db.execAsync("PRAGMA user_version = 7");
  repo = await createRepository(db);
  repo = await createRepository(db);
  expect(
    (await repo.listChannels({ includeVariants: true })).map((row) => [
      row.checkStatus,
      row.checkedAt,
    ]),
  ).toEqual([
    ["unreachable", 20],
    ["unreachable", 20],
  ]);
});

test("sources report their stored result per distinct address", async () => {
  const text = content([
    { name: "ok", url: "https://example.com/ok.m3u8", id: "ok" },
    { name: "ok-copy", url: "https://example.com/ok.m3u8", id: "ok-copy" },
    { name: "down", url: "https://example.com/down.m3u8", id: "down" },
    { name: "new", url: "https://example.com/new.m3u8", id: "new" },
  ]);
  const checked = await repo.importSource({
    name: "checked",
    kind: "file",
    location: "checked.m3u",
    content: text,
    preview: await parseM3U(text),
  });
  const untouched = await add("untouched", "https://example.com/elsewhere");
  const rows = await repo.listChannels({
    sourceId: checked.id,
    includeVariants: true,
  });
  const id = (name: string) => rows.find((row) => row.name === name)!.id;
  await repo.saveCheckResults([
    { channelId: id("ok"), streamUrl: "https://example.com/ok.m3u8", ok: true },
    {
      channelId: id("down"),
      streamUrl: "https://example.com/down.m3u8",
      ok: false,
    },
  ]);
  const sources = await repo.listSources();
  expect(sources.find((source) => source.id === checked.id)).toMatchObject({
    reachableCount: 1,
    unreachableCount: 1,
  });
  expect(
    sources.find((source) => source.id === checked.id)?.lastCheckedAt,
  ).toEqual(expect.any(Number));
  expect(sources.find((source) => source.id === untouched.id)).toMatchObject({
    reachableCount: 0,
    unreachableCount: 0,
    lastCheckedAt: null,
  });
});
