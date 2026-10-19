import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { normalizeRemoteUrl } from "../domain/url";
import { linkedDeadline } from "../lib/abort";
import { M3U_LIMITS, MAX_MIB } from "../domain/m3u";
import { decodePlaylistBytes, TextEncodingError } from "../domain/textEncoding";
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
        new Promise<never>((_unused, reject) => {
          timer = setTimeout(
            () => reject(new ImportIOError("读取超时，请检查网络后重试")),
            15000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (signal.aborted) throw new ImportIOError("导入已取消");
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxBytes)
        throw new ImportIOError(`节目单超过 ${MAX_MIB} MB，请拆分后导入`);
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return decodePlaylistBytes(bytes).text;
    } catch (error) {
      throw new ImportIOError(
        error instanceof TextEncodingError
          ? error.message
          : "无法识别文件编码，请另存为 UTF-8 后导入",
      );
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
  if (!allowed) throw new ImportIOError("需要先允许联网");
  const url = normalizeRemoteUrl(input);
  const deadline = linkedDeadline(signal, 60000);
  const connect = setTimeout(deadline.abort, 10000);
  try {
    const response = await expoFetch(url, {
      signal: deadline.signal,
      headers: { Accept: "application/x-mpegURL, audio/x-mpegurl, text/plain" },
    });
    clearTimeout(connect);
    if (!response.ok)
      throw new ImportIOError(
        response.status === 401 || response.status === 403
          ? "节目单服务器拒绝访问，链接可能已过期，请向提供方确认"
          : response.status === 404 || response.status === 410
            ? "节目单地址不存在，请检查链接"
            : `节目单服务器暂时无响应（错误码 ${response.status}），请稍后再试`,
      );
    if (Number(response.headers.get("content-length")) > MAX_IMPORT_BYTES)
      throw new ImportIOError(`节目单超过 ${MAX_MIB} MB）`);
    if (!response.body) throw new ImportIOError("服务器未返回内容，请检查链接");
    const finalUrl = normalizeRemoteUrl(response.url || url);
    return {
      text: await readBoundedStream(response.body, deadline.signal),
      url: finalUrl,
    };
  } catch (error) {
    if (error instanceof ImportIOError) throw error;
    throw new ImportIOError(
      signal.aborted
        ? "导入已取消"
        : deadline.signal.aborted
          ? "连接或读取超时，请重试"
          : "节目单读取未完成，请检查网络或链接",
    );
  } finally {
    clearTimeout(connect);
    deadline.close();
  }
}
export async function readPickedFile(
  uri: string,
  signal: AbortSignal,
): Promise<string> {
  const file = new File(uri);
  try {
    if (!file.exists) throw new ImportIOError("所选文件无法访问，请重新选择");
    if (file.size > MAX_IMPORT_BYTES)
      throw new ImportIOError(`文件超过 ${MAX_MIB} MB）`);
    return await readBoundedStream(file.readableStream(), signal);
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      /* Cache cleanup may fail; never remove the original provider file. */
    }
  }
}
