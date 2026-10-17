import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { normalizeRemoteUrl } from "../domain/url";
import { M3U_LIMITS, MAX_MIB } from "../domain/m3u";
export const MAX_IMPORT_BYTES = M3U_LIMITS.maxBytes;
export class ImportIOError extends Error {}
export async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  maxBytes = MAX_IMPORT_BYTES,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel);
  try {
    while (true) {
      if (signal.aborted) throw new ImportIOError("导入已取消");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ImportIOError("读取超时，请检查连接后重试")),
            15000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (signal.aborted) throw new ImportIOError("导入已取消");
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxBytes)
        throw new ImportIOError(`节目单超过 ${MAX_MIB} MiB 上限，请拆分后导入`);
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ImportIOError("文件不是有效 UTF-8 编码，请转换后重试");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function downloadPlaylist(
  input: string,
  signal: AbortSignal,
  allowed: boolean,
): Promise<{ text: string; url: string }> {
  if (!allowed) throw new ImportIOError("尚未允许联网，请先阅读网络风险说明");
  const url = normalizeRemoteUrl(input);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  if (signal.aborted) abort();
  const total = setTimeout(abort, 60000);
  const connect = setTimeout(abort, 10000);
  try {
    const response = await expoFetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/x-mpegURL, audio/x-mpegurl, text/plain" },
    });
    clearTimeout(connect);
    if (!response.ok)
      throw new ImportIOError(
        response.status === 401 || response.status === 403
          ? "节目单访问被拒绝，请检查授权或有效期"
          : response.status === 404 || response.status === 410
            ? "节目单地址已失效，请检查链接"
            : `节目单服务器返回 HTTP ${response.status}，请稍后重试`,
      );
    if (Number(response.headers.get("content-length")) > MAX_IMPORT_BYTES)
      throw new ImportIOError(`节目单超过 ${MAX_MIB} MiB 上限`);
    if (!response.body) throw new ImportIOError("服务器没有返回节目单");
    const finalUrl = normalizeRemoteUrl(response.url || url);
    return {
      text: await readBoundedStream(response.body, controller.signal),
      url: finalUrl,
    };
  } catch (error) {
    if (error instanceof ImportIOError) throw error;
    throw new ImportIOError(
      signal.aborted
        ? "导入已取消"
        : controller.signal.aborted
          ? "连接或读取超时，请重试"
          : "无法读取节目单，请检查网络或来源地址",
    );
  } finally {
    clearTimeout(total);
    clearTimeout(connect);
    signal.removeEventListener("abort", abort);
    controller.abort();
  }
}
export async function readPickedFile(
  uri: string,
  signal: AbortSignal,
): Promise<string> {
  const file = new File(uri);
  try {
    if (!file.exists) throw new ImportIOError("所选文件已不可访问，请重新选择");
    if (file.size > MAX_IMPORT_BYTES)
      throw new ImportIOError(`文件超过 ${MAX_MIB} MiB 上限`);
    return await readBoundedStream(file.readableStream(), signal);
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      /* Cache cleanup may fail; never remove the original provider file. */
    }
  }
}
