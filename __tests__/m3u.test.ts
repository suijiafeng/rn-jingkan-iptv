import {
  M3U_LIMITS,
  M3UParseError,
  parseM3U,
  utf8ByteLength,
} from "../src/domain/m3u";
import { normalizeRemoteUrl } from "../src/domain/url";

const line = (name: string, url: string, attrs = "") =>
  `#EXTINF:-1 ${attrs},${name}\n${url}`;
const m3u = (...channels: string[]) => `#EXTM3U\n${channels.join("\n")}`;

describe("M3U bounded import parser", () => {
  it("reads BOM, Chinese names, quoted commas, CRLF, and unknown comments", async () => {
    const text =
      '\uFEFF#EXTM3U\r\n\r\n#comment\r\n#EXTINF:-1 tvg-id="news" tvg-name="备用名称" group-title="新闻,综合" tvg-logo="https://img.example.com/a,b.png",频道,一\r\nhttps://stream.example.com/news?token=ABC%2Fdef&z=2&a=1\r\n';
    const result = await parseM3U(text);
    expect(result.channels[0]).toMatchObject({
      name: "频道,一",
      groupName: "新闻,综合",
      tvgId: "news",
      identityKey: "id:news",
    });
    expect(result.channels[0].streamUrl).toBe(
      "https://stream.example.com/news?token=ABC%2Fdef&z=2&a=1",
    );
    expect(result.stats).toMatchObject({
      valid: 1,
      ignored: 0,
      bytes: utf8ByteLength(text),
    });
  });

  it("normalizes only URL semantics and keeps path case, query order and token values", async () => {
    const result = await parseM3U(
      m3u(line("一", "HTTPS://STREAM.EXAMPLE.COM:443/ABC?Token=X%2fy&b=2&a=1")),
    );
    expect(result.channels[0].streamUrl).toBe(
      "https://stream.example.com/ABC?Token=X%2fy&b=2&a=1",
    );
  });

  it("uses unique tvg-id, falls back to exact URL for repeated IDs, and retains same-name different URLs", async () => {
    const result = await parseM3U(
      m3u(
        line("甲", "https://a.example.com/one", 'tvg-id="same"'),
        line("甲", "https://a.example.com/one", 'tvg-id="same"'),
        line("乙", "https://a.example.com/two", 'tvg-id="same"'),
        line("甲", "https://a.example.com/three"),
        line("重复", "https://a.example.com/three"),
        line("独立", "https://a.example.com/four", 'tvg-id="unique"'),
      ),
    );
    expect(result.stats).toMatchObject({ valid: 4, duplicates: 2, total: 6 });
    expect(result.channels.map((c) => c.identityKey)).toEqual([
      "url:https://a.example.com/one",
      "url:https://a.example.com/two",
      "url:https://a.example.com/three",
      "id:unique",
    ]);
    expect(result.channels[2].name).toBe("甲");
  });

  it("keeps a trusted tvg-id when its normalized URL is repeated", async () => {
    const result = await parseM3U(
      m3u(
        line("新闻", "https://a.example.com/live", 'tvg-id="news"'),
        line("新闻", "HTTPS://A.EXAMPLE.COM:443/live", 'tvg-id="news"'),
      ),
    );
    expect(result.channels).toMatchObject([
      { identityKey: "id:news", streamUrl: "https://a.example.com/live" },
    ]);
    expect(result.channels).toHaveLength(1);
    expect(result.stats).toMatchObject({ valid: 1, duplicates: 1, total: 2 });
    expect(result.issues).toEqual([{ line: 4, reason: "duplicate" }]);
  });

  it("supports HTTP only as metadata and reports how many accepted entries use it", async () => {
    const result = await parseM3U(
      m3u(line("明文", "http://a.example.com/live")),
    );
    expect(result.stats.http).toBe(1);
  });

  it("resolves relative entries only from a valid network playlist URL", async () => {
    const result = await parseM3U(m3u(line("相对", "../live?q=Ab%2f")), {
      baseUrl: "https://a.example.com/list/channels.m3u",
    });
    expect(result.channels[0].streamUrl).toBe(
      "https://a.example.com/live?q=Ab%2f",
    );
    const invalid = await parseM3U(
      m3u(
        line("本地相对", "live.m3u8"),
        line("合法", "https://a.example.com/live"),
      ),
    );
    expect(invalid.issueCounts.relative_without_base).toBe(1);
  });

  it("counts invalid entries without exposing URL tokens in issues", async () => {
    const result = await parseM3U(
      m3u(
        line("私网", "http://127.0.0.1/?token=secret"),
        line("协议", "file:///etc/passwd"),
        "#EXTINF:-1,悬空",
        line("合法", "https://a.example.com/live"),
        "https://a.example.com/orphan",
      ),
    );
    expect(result.stats).toMatchObject({ valid: 1, ignored: 4, total: 5 });
    expect(result.issueCounts).toEqual({
      unsafe_url: 1,
      unsupported_protocol: 1,
      dangling_extinf: 1,
      missing_extinf: 1,
    });
    expect(JSON.stringify(result.issues)).not.toContain("secret");
  });

  it("uses tvg-name then placeholder and a default group", async () => {
    const result = await parseM3U(
      m3u(
        line("", "https://a.example.com/1", 'tvg-name="备用" group-title=""'),
        line("", "https://a.example.com/2"),
      ),
    );
    expect(result.channels.map((c) => [c.name, c.groupName])).toEqual([
      ["备用", "未分组"],
      ["未命名频道", "未分组"],
    ]);
  });

  it.each([
    "#EXT-X-TARGETDURATION:10",
    "#EXT-X-STREAM-INF:BANDWIDTH=100",
    "#EXT-X-MEDIA-SEQUENCE:20",
    "#EXT-X-KEY:METHOD=AES-128",
  ])("rejects HLS directories with %s", async (tag) => {
    await expect(
      parseM3U(
        `#EXTM3U\n${tag}\n#EXTINF:5,segment\nhttps://a.example.com/segment.ts`,
      ),
    ).rejects.toMatchObject({ code: "hls_playlist" });
  });

  it("ignores non-structural #EXT-X-* lines inside a channel directory", async () => {
    const result = await parseM3U(
      "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-APP-NOTE:x\n#EXTINF:-1,新闻\nhttps://a.example.com/news.m3u8",
    );
    expect(result.channels.map((c) => c.name)).toEqual(["新闻"]);
  });

  it.each([
    ["", "empty"],
    ["<html>not a playlist</html>", "missing_header"],
    ["#EXTM3U\n", "no_channels"],
    ["#EXTM3U\n\uFFFD", "invalid_encoding"],
    ["#EXTM3U\n\uD800", "invalid_encoding"],
    [`#EXTM3U\n${"x".repeat(M3U_LIMITS.maxLineBytes + 1)}`, "line_too_long"],
    ["x".repeat(M3U_LIMITS.maxBytes + 1), "too_large"],
  ])("rejects bounded/invalid input case %#", async (text, code) => {
    await expect(parseM3U(text)).rejects.toMatchObject({ code });
  });

  it("enforces byte rather than JS character limits", async () => {
    await expect(
      parseM3U(`#EXTM3U\n#${"中".repeat(23_000)}`),
    ).rejects.toMatchObject({ code: "line_too_long" });
  });

  it("rejects over 20,000 entries even if they repeat", async () => {
    const text = m3u(
      ...Array.from({ length: 20_001 }, () =>
        line("A", "https://a.example.com/x"),
      ),
    );
    await expect(
      parseM3U(text, { yieldControl: async () => undefined }),
    ).rejects.toMatchObject({ code: "too_many_entries" });
  });

  it("yields at least every 200 lines and supports cancellation at yields", async () => {
    const scheduler = jest.fn(async () => undefined);
    await parseM3U(
      m3u(
        ...Array.from({ length: 220 }, (_, i) =>
          line(`频道${i}`, `https://a.example.com/${i}`),
        ),
      ),
      { yieldControl: scheduler },
    );
    expect(scheduler.mock.calls.length).toBeGreaterThanOrEqual(2);
    const controller = new AbortController();
    await expect(
      parseM3U(
        m3u(
          ...Array.from({ length: 300 }, (_, i) =>
            line(`${i}`, `https://a.example.com/${i}`),
          ),
        ),
        {
          signal: controller.signal,
          yieldControl: async () => {
            controller.abort();
          },
        },
      ),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("bounds diagnostic records without losing counts", async () => {
    const result = await parseM3U(
      m3u(
        ...Array.from({ length: 120 }, () => line("坏", "file:///tmp/a")),
        line("合法", "https://a.example.com/live"),
      ),
    );
    expect(result.issues).toHaveLength(100);
    expect(result.issueCounts.unsupported_protocol).toBe(120);
  });

  it("uses recognizable, redacted error messages", () => {
    expect(new M3UParseError("too_large").message).toContain("8 MiB");
  });
});

describe("remote URL input policy (not DNS or HLS-hop isolation)", () => {
  it.each([
    "http://localhost/live",
    "https://@a.example.com/live",
    "http://router.home.arpa/live",
    "http://localhost./live",
    "http://tv.local/live",
    "http://router/live",
    "http://127.0.0.1/live",
    "http://127.1/live",
    "http://2130706433/live",
    "http://0x7f000001/live",
    "http://10.2.3.4/live",
    "http://172.16.0.1/live",
    "http://192.168.1.1/live",
    "http://169.254.169.254/",
    "http://100.64.0.1/live",
    "http://0.0.0.0/live",
    "http://224.0.0.1/live",
    "http://198.18.0.1/live",
    "http://[::1]/live",
    "http://[fe80::1]/live",
    "http://[fc00::1]/live",
    "http://[::ffff:127.0.0.1]/live",
    "http://[2002:7f00:0001::]/live",
    "https://user:pass@a.example.com/live",
    "http://a.example.com:22/live",
    "http://a.example.com:6379/live",
    "http://a.example.com:25/live",
    "http://a.example.com:445/live",
    "http://a.example.com:554/live",
    "https://a.example.com/\nsecret",
    "https://a.example.com\\evil",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "file:///tmp/live",
  ])("rejects unsafe address %s", (url) => {
    expect(() => normalizeRemoteUrl(url)).toThrow();
  });
  it.each([
    "https://192.2.1.1/live",
    "https://8.8.8.8/live",
    "http://a.example.com:8080/live",
    // Real public streaming servers use these non-standard low ports.
    "http://a.example.com:81/live/cctv1.m3u8",
    "http://a.example.com:82/live",
    "http://a.example.com:85/live",
    "http://a.example.com:98/live",
    "https://[2606:4700:4700::1111]/live",
  ])("permits ordinary public addresses %s", (url) => {
    expect(normalizeRemoteUrl(url)).toBe(url);
  });
});
