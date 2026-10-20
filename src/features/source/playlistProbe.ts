import { normalizeLanguages } from "../../domain/channelFacets";

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

/**
 * Audio languages a master playlist declares on its #EXT-X-MEDIA:TYPE=AUDIO
 * entries, as base codes ("zh-CN" → "zh"). Only what the stream states;
 * names and URLs are never read. Null when the text is not a master
 * playlist, so a media playlist or a segment says nothing about language.
 */
export function audioLanguages(
  text: string,
  complete: boolean,
): string[] | null {
  const body = complete ? text : text.slice(0, text.lastIndexOf("\n") + 1);
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  if (!lines.some((line) => line.startsWith("#EXT-X-STREAM-INF"))) return null;
  const found = new Set<string>();
  for (const line of lines) {
    if (!line.startsWith("#EXT-X-MEDIA:")) continue;
    if (!/(?:^|[:,])TYPE=AUDIO(?:,|$)/.test(line)) continue;
    const declared = /(?:^|[:,])LANGUAGE="([^"]*)"/.exec(line)?.[1];
    for (const code of normalizeLanguages(declared))
      found.add(code.split("-")[0]);
  }
  return [...found];
}
