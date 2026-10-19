export interface StreamHead {
  bytes: Uint8Array;
  /** The body ended within the limit, so nothing was cut off. */
  ended: boolean;
}

/**
 * Reads at most `limit` bytes from the start of a body, then cancels it: live
 * streams may ignore Range and never end.
 */
export async function readStreamHead(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<StreamHead> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let ended = false;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      const part = value.subarray(0, limit - size);
      chunks.push(part);
      size += part.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, ended };
}
