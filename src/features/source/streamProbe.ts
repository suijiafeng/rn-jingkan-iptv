import { fetch as expoFetch } from "expo/fetch";
import { normalizeRemoteUrl } from "../../domain/url";
import { abortableDelay, linkedDeadline } from "../../lib/abort";
import { readStreamHead } from "../../lib/streamHead";
import { looksLikePlaylist, nextProbeStep } from "./playlistProbe";

/** Per request; one attempt may make up to four, see CHECK_ATTEMPT_BUDGET_MS. */
export const CHECK_TIMEOUT_MS = 8000;
/** Pause before the single retry, so a brief network blip can clear. */
export const CHECK_RETRY_DELAY_MS = 1000;
/** One attempt follows at most master → media playlist → segment. */
export const CHECK_ATTEMPT_BUDGET_MS = 15000;
/** A playlist is read until its first usable line, never beyond this. */
export const PLAYLIST_MAX_BYTES = 64 * 1024;
const PROBE_BYTES = 1024;
const MAX_PLAYLIST_DEPTH = 2;

/**
 * "error" = no usable answer that a moment later might change: DNS, connect,
 * reset, timeout, or a temporary status (408, 429, 5xx).
 */
type Attempt = "ok" | "failed" | "error";

interface Fetched {
  status: number;
  ok: boolean;
  url: string;
  mime: string;
  text: string;
  /** The whole body was read, so its last line is not cut off. */
  complete: boolean;
}

const temporaryStatus = (status: number) =>
  status === 408 || status === 429 || (status >= 500 && status <= 599);

const outcome = (fetched: Fetched): Attempt | null =>
  fetched.ok ? null : temporaryStatus(fetched.status) ? "error" : "failed";

async function request(
  url: string,
  signal: AbortSignal,
  range: boolean,
  limit: number,
): Promise<Fetched> {
  const deadline = linkedDeadline(signal, CHECK_TIMEOUT_MS);
  try {
    const response = await expoFetch(url, {
      signal: deadline.signal,
      ...(range ? { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` } } : {}),
    });
    const fetched: Fetched = {
      status: response.status,
      ok: response.ok,
      url: response.url || url,
      mime: response.headers?.get("content-type") ?? "",
      text: "",
      complete: false,
    };
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => {});
      return fetched;
    }
    const head = await readStreamHead(response.body, limit);
    fetched.text = new TextDecoder("utf-8").decode(head.bytes);
    // A 206 shorter than the requested range is the whole file.
    fetched.complete =
      head.ended &&
      (response.status !== 206 || head.bytes.byteLength < PROBE_BYTES);
    return fetched;
  } finally {
    deadline.close();
  }
}

/** Some servers answer a Range request with 416; ask once without it. */
async function requestHead(url: string, signal: AbortSignal) {
  const head = await request(url, signal, true, PROBE_BYTES);
  return head.status === 416 ? request(url, signal, false, PROBE_BYTES) : head;
}

async function followAddress(
  url: string,
  signal: AbortSignal,
  depth: number,
): Promise<Attempt> {
  const head = await requestHead(url, signal);
  const headFailure = outcome(head);
  if (headFailure) return headFailure;
  if (depth > MAX_PLAYLIST_DEPTH || !looksLikePlaylist(head.mime, head.text))
    return "ok";
  // A Range answer holds only the first KiB; read the playlist itself.
  const playlist = head.complete
    ? head
    : await request(head.url, signal, false, PLAYLIST_MAX_BYTES);
  const playlistFailure = outcome(playlist);
  if (playlistFailure) return playlistFailure;
  const step = nextProbeStep(playlist.text, playlist.complete);
  // The playlist answered; an empty live window cannot be probed further.
  if (!step) return "ok";
  let next: string;
  try {
    // Same address rules as imports: private or special hosts are not probed.
    next = normalizeRemoteUrl(step.uri, playlist.url);
  } catch {
    return "ok";
  }
  return followAddress(
    next,
    signal,
    step.kind === "playlist" ? depth + 1 : MAX_PLAYLIST_DEPTH + 1,
  );
}

async function attemptStream(
  url: string,
  signal: AbortSignal,
): Promise<Attempt> {
  const deadline = linkedDeadline(signal, CHECK_ATTEMPT_BUDGET_MS);
  try {
    return await followAddress(url, deadline.signal, 0);
  } catch {
    return "error";
  } finally {
    deadline.close();
  }
}

/**
 * User-triggered only. A Range 0-1023 request per address; an HLS playlist is
 * followed to its first variant and first segment, each probed the same way.
 * "ok" means every step answered with a success status, not that the stream
 * decodes or plays. A network failure or temporary status is retried once;
 * any other HTTP error is the server's answer and is not.
 */
export async function checkStream(
  url: string,
  signal: AbortSignal,
): Promise<boolean> {
  const first = await attemptStream(url, signal);
  if (first !== "error") return first === "ok";
  await abortableDelay(CHECK_RETRY_DELAY_MS, signal);
  if (signal.aborted) return false;
  return (await attemptStream(url, signal)) === "ok";
}
