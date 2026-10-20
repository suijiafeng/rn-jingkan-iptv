/** @jest-environment node */
import { parseBackup } from "../src/data/backup";
import {
  importInitialInto,
  openTestRepository,
} from "./support/repositoryTestKit";

test("offline backup round-trip preserves stable identities, sources and favorites, resets consent and history", async () => {
  const origin = await openTestRepository(),
    target = await openTestRepository();
  try {
    await importInitialInto(origin.repo);
    const [originSource] = await origin.repo.listSources();
    const [channel] = await origin.repo.listChannels();
    await origin.repo.toggleFavorite(channel.id);
    await origin.repo.recordRecent(channel.id);
    for (const key of ["remoteAllowed", "artworkAllowed", "swipeReverse"])
      await origin.repo.setSetting(key, true);
    await origin.repo.setSetting("regionPreference", {
      ipAllowed: true,
      locationAllowed: true,
    });
    await origin.repo.setSourceEnabled(originSource.id, false);
    const text = await origin.repo.exportBackup();
    expect(text).not.toContain("lastPlayedAt");
    expect(text).not.toContain("remoteAllowed");
    expect(text).not.toContain("regionPreference");
    await importInitialInto(target.repo);
    await target.repo.setSetting("remoteAllowed", true);
    await target.repo.restoreBackup(text);
    expect(await target.repo.listSources()).toMatchObject([
      { id: originSource.id, enabled: false },
    ]);
    expect(await target.repo.listChannels()).toEqual([]);
    await target.repo.setSourceEnabled(originSource.id, true);
    await origin.repo.setSourceEnabled(originSource.id, true);
    expect((await target.repo.listChannels()).map((row) => row.id)).toEqual(
      (await origin.repo.listChannels()).map((row) => row.id),
    );
    expect((await target.repo.listFavorites())[0].id).toBe(channel.id);
    expect(await target.repo.listRecent()).toEqual([]);
    expect(await target.repo.getSetting("remoteAllowed", false)).toBe(false);
    expect(await target.repo.getSetting("artworkAllowed", false)).toBe(false);
    expect(await target.repo.getSetting("swipeReverse", false)).toBe(true);
    expect(
      await target.repo.getSourceContent(
        (await target.repo.listSources())[0].id,
      ),
    ).toContain("#EXTM3U");
  } finally {
    origin.db.native.close();
    target.db.native.close();
  }
});

test("restore is atomic on disk errors and rejects future, unsafe and dangling data before replacement", async () => {
  const { repo, db } = await openTestRepository();
  try {
    await importInitialInto(repo);
    const text = await repo.exportBackup(),
      before = await repo.listChannels();
    db.failWhen = (sql) => sql.startsWith("INSERT INTO channels");
    await expect(repo.restoreBackup(text)).rejects.toThrow();
    db.failWhen = undefined;
    expect(await repo.listChannels()).toEqual(before);
    const invalid = [
      { ...JSON.parse(text), version: 9 },
      { ...JSON.parse(text), sources: [] },
      {
        ...JSON.parse(text),
        favorites: [{ groupKey: "missing", createdAt: 1 }],
      },
      {
        ...JSON.parse(text),
        channels: [
          {
            ...JSON.parse(text).channels[0],
            streamUrl: "http://127.0.0.1/private",
          },
        ],
      },
      {
        ...JSON.parse(text),
        channels: [JSON.parse(text).channels[0], JSON.parse(text).channels[0]],
      },
    ];
    for (const value of invalid) {
      expect(() => parseBackup(JSON.stringify(value))).toThrow();
      await expect(repo.restoreBackup(JSON.stringify(value))).rejects.toThrow();
      expect(await repo.listChannels()).toEqual(before);
    }
  } finally {
    db.native.close();
  }
});

test("empty backups are valid and unrecognized preferences never restore permissions", async () => {
  const { repo, db } = await openTestRepository();
  try {
    const backup = JSON.parse(await repo.exportBackup());
    backup.preferences.remoteAllowed = true;
    backup.preferences.artworkAllowed = true;
    await repo.restoreBackup(JSON.stringify(backup));
    expect(await repo.listSources()).toEqual([]);
    expect(await repo.getSetting("remoteAllowed", false)).toBe(false);
    expect(await repo.getSetting("artworkAllowed", false)).toBe(false);
  } finally {
    db.native.close();
  }
});

test("the mini player choice travels in backups, and older files still restore", async () => {
  const origin = await openTestRepository(),
    target = await openTestRepository();
  try {
    await origin.repo.setSetting("miniPlayer", false);
    const text = await origin.repo.exportBackup();
    // Still written so an older app, which requires it, can restore this.
    expect(JSON.parse(text).preferences.skipUnreachable).toBe(true);
    await target.repo.restoreBackup(text);
    expect(await target.repo.getSetting("miniPlayer", true)).toBe(false);

    // A file from before the switch existed restores with it on.
    const older = JSON.parse(text);
    delete older.preferences.miniPlayer;
    await target.repo.restoreBackup(JSON.stringify(older));
    expect(await target.repo.getSetting("miniPlayer", false)).toBe(true);
  } finally {
    origin.db.native.close();
    target.db.native.close();
  }
});

test("source and group languages travel in backups; older files restore without them", async () => {
  const origin = await openTestRepository(),
    target = await openTestRepository();
  try {
    await importInitialInto(origin.repo);
    const [source] = await origin.repo.listSources();
    await origin.repo.setSourceLanguages(source.id, {
      defaultLanguage: "zh",
      groups: { 体育: "en" },
    });
    const text = await origin.repo.exportBackup();
    await target.repo.restoreBackup(text);
    expect(await target.repo.getSourceLanguages(source.id)).toEqual({
      defaultLanguage: "zh",
      groups: { 体育: "en" },
    });

    // A file from before languages could be chosen.
    const older = JSON.parse(text);
    delete older.groupLanguages;
    for (const row of older.sources) delete row.defaultLanguage;
    await target.repo.restoreBackup(JSON.stringify(older));
    expect(await target.repo.getSourceLanguages(source.id)).toEqual({
      defaultLanguage: "",
      groups: {},
    });

    // Anything but one stored code, or a dangling source, is refused.
    for (const broken of [
      {
        ...JSON.parse(text),
        groupLanguages: [
          { sourceId: "nope", groupName: "体育", language: "en" },
        ],
      },
      {
        ...JSON.parse(text),
        groupLanguages: [
          { sourceId: source.id, groupName: "体育", language: "English" },
        ],
      },
    ])
      expect(() => parseBackup(JSON.stringify(broken))).toThrow();
  } finally {
    origin.db.native.close();
    target.db.native.close();
  }
});
