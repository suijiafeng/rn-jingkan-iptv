import { fetch as expoFetch } from "expo/fetch";
import type { ContentType } from "expo-video";
import { linkedDeadline } from "../../lib/abort";
import { readStreamHead } from "../../lib/streamHead";

export const SNIFF_BYTES = 1024;
export const SNIFF_TIMEOUT_MS = 8000;

/**
 * On Android, expo-video passes no MIME type for "auto", so ExoPlayer infers
 * the format from the URL suffix only. A suffix-less HLS address would then be
 * opened as a progressive file and fail. Returns null when the suffix is not
 * conclusive and the first bytes must be inspected.
 */
export function contentTypeFromPath(uri: string): ContentType | null {
  let pathname: string;
  try {
    pathname = new URL(uri).pathname.toLowerCase();
  } catch {
    return "auto";
  }
  if (pathname.endsWith(".m3u8")) return "hls";
  if (pathname.endsWith(".mpd")) return "dash";
  if (/\.(?:mp4|m4v|m4a|mov|webm|mkv|ts|mts|flv|mp3|aac|ogg)$/.test(pathname))
    return "auto";
  return null;
}

/** Classifies the start of a response body. Unknown content stays "auto". */
export function contentTypeFromHead(head: string): ContentType {
  const text = head.replace(/^﻿/, "").trimStart();
  if (/^#EXTM3U/i.test(text)) return "hls";
  if (/<MPD[\s>]/i.test(text)) return "dash";
  return "auto";
}

/**
 * One bounded request (Range 0-1023, at most 1 KiB read, 8 s budget) made only
 * inside an already-approved playback attempt. Any failure falls back to
 * "auto" so the native player reports the real error; nothing is logged.
 */
export async function resolveContentType(
  uri: string,
  signal: AbortSignal,
): Promise<ContentType> {
  const known = contentTypeFromPath(uri);
  if (known) return known;
  const deadline = linkedDeadline(signal, SNIFF_TIMEOUT_MS);
  try {
    const response = await expoFetch(uri, {
      signal: deadline.signal,
      headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` },
    });
    if (!response.ok || !response.body) return "auto";
    const mime = (response.headers.get("content-type") ?? "").toLowerCase();
    if (mime.includes("mpegurl")) return "hls";
    if (mime.includes("dash+xml")) return "dash";
    const { bytes } = await readStreamHead(response.body, SNIFF_BYTES);
    return contentTypeFromHead(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return "auto";
  } finally {
    deadline.close();
  }
}
