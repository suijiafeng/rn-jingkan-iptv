import { normalizeRemoteUrl } from "./url";

/** Input policy only; the native image loader owns DNS and redirect handling. */
export function channelArtworkUrl(
  uri: string | null | undefined,
): string | null {
  if (!uri || uri.length > 4096) return null;
  try {
    const normalized = normalizeRemoteUrl(uri);
    return new URL(normalized).protocol === "https:" ? normalized : null;
  } catch {
    return null;
  }
}
