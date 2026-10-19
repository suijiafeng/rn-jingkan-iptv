export type ProbeStep =
  { kind: "playlist"; uri: string } | { kind: "segment"; uri: string };

/** True when a response announces or starts like an HLS playlist. */
export function looksLikePlaylist(mime: string, head: string): boolean {
  if (mime.toLowerCase().includes("mpegurl")) return true;
  return /^#EXTM3U/i.test(head.replace(/^﻿/, "").trimStart());
}

/**
 * The next address an availability check should touch: the first variant of
 * a master playlist, or the first media segment of a media playlist. A body
 * cut off by the read limit drops its unfinished last line. Returns null when
 * nothing usable is listed (an empty live window, or unparseable text).
 */
export function nextProbeStep(
  text: string,
  complete: boolean,
): ProbeStep | null {
  const body = complete ? text : text.slice(0, text.lastIndexOf("\n") + 1);
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const isUri = (line: string) => line !== "" && !line.startsWith("#");
  const variantTag = lines.findIndex((line) =>
    line.startsWith("#EXT-X-STREAM-INF"),
  );
  if (variantTag >= 0) {
    const uri = lines.slice(variantTag + 1).find(isUri);
    return uri ? { kind: "playlist", uri } : null;
  }
  const uri = lines.find(isUri);
  return uri ? { kind: "segment", uri } : null;
}
