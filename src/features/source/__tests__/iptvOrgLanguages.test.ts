import { ReadableStream } from "node:stream/web";
import { TextDecoder, TextEncoder } from "node:util";
import {
  IPTV_ORG_FEEDS_URL,
  LanguageLookupError,
  languagesFromFeeds,
  lookupIptvOrgLanguages,
} from "../iptvOrgLanguages";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: jest.fn() }));
const { fetch: fetchMock } = jest.requireMock("expo/fetch");
Object.assign(globalThis, { TextDecoder, TextEncoder });

const feeds = [
  { channel: "CCTV1.cn", id: "SD", is_main: true, languages: ["zho"] },
  { channel: "CCTV1.cn", id: "HD", is_main: false, languages: ["zho", "eng"] },
  { channel: "TVB.hk", id: "SD", is_main: true, languages: ["yue"] },
  { channel: "Bad.us", id: 3, languages: ["eng"] },
  { channel: "Empty.us", id: "SD", languages: [] },
  "garbage",
];

test("maps feed ids and ISO 639-3 codes, using the main feed for bare ids", () => {
  const found = languagesFromFeeds(
    feeds,
    new Set(["CCTV1.cn@HD", "TVB.hk", "Missing.us@SD", "Empty.us@SD"]),
  );
  expect(found.get("CCTV1.cn@HD")).toEqual(["zh", "en"]);
  expect(found.get("TVB.hk")).toEqual(["yue"]);
  expect(found.has("Missing.us@SD")).toBe(false);
  expect(found.has("Empty.us@SD")).toBe(false);
  expect(languagesFromFeeds({ not: "an array" }, new Set(["x"])).size).toBe(0);
});

function body(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

test("downloads the fixed iptv-org feeds file once and parses it", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    body: body(JSON.stringify(feeds)),
  });
  const found = await lookupIptvOrgLanguages(
    new Set(["CCTV1.cn@SD"]),
    new AbortController().signal,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(IPTV_ORG_FEEDS_URL);
  expect(found.get("CCTV1.cn@SD")).toEqual(["zh"]);
});

test("HTTP errors, broken JSON and cancellation become readable errors", async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 503, body: null });
  await expect(
    lookupIptvOrgLanguages(new Set(), new AbortController().signal),
  ).rejects.toThrow(/错误码 503/);
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body: body("{") });
  await expect(
    lookupIptvOrgLanguages(new Set(), new AbortController().signal),
  ).rejects.toBeInstanceOf(LanguageLookupError);
  const owner = new AbortController();
  owner.abort();
  fetchMock.mockRejectedValueOnce(new Error("aborted"));
  await expect(lookupIptvOrgLanguages(new Set(), owner.signal)).rejects.toThrow(
    "已停止补全语言",
  );
});
