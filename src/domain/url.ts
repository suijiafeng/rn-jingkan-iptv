export type UrlErrorCode =
  | "invalid_url"
  | "unsafe_url"
  | "unsupported_protocol"
  | "relative_without_base";

export class UrlValidationError extends Error {
  constructor(public readonly code: UrlErrorCode) {
    super(
      {
        invalid_url: "地址格式不正确。",
        unsafe_url: "不支持包含登录信息、本机、私网或特殊用途的地址。",
        unsupported_protocol: "只支持 HTTP 或 HTTPS 网络地址。",
        relative_without_base:
          "本地文件中的相对地址无法解析，请使用完整网络地址。",
      }[code],
    );
    this.name = "UrlValidationError";
  }
}

function unsafeIPv4(host: string): boolean {
  const n = host.split(".").map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return true;
  const [a, b, c] = n;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function unsafeIPv6(host: string): boolean {
  const unwrapped = host.replace(/^\[|\]$/g, "");
  // Deliberately permit only ordinary global unicast literals. This also rejects
  // IPv4-mapped/compatible, loopback, link-local, multicast and unique-local IPs.
  const first = parseInt(unwrapped.split(":")[0], 16);
  if (first < 0x2000 || first > 0x3fff || !Number.isFinite(first)) return true;
  const [head, tail] = unwrapped.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const parts =
    tail !== undefined
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  const words = parts.map((word) => parseInt(word || "0", 16));
  // Documentation, tunnelling, benchmark, and special-purpose reservations.
  return (
    first === 0x2002 ||
    (first === 0x2001 && (words[1] <= 0x01ff || words[1] === 0x0db8)) ||
    (first === 0x3fff && words[1] < 0x1000)
  );
}

const BLOCKED_PORTS = new Set([
  1900, 2049, 2375, 2376, 3306, 3389, 5432, 5353, 5900, 6379, 9200, 11211,
]);

/** Input validation only: DNS answers, redirects and native HLS subrequests are not inspected. */
export function normalizeRemoteUrl(input: string, baseUrl?: string): string {
  const raw = input.trim();
  if (!raw || /[\u0000-\u0020\u007f\\]/.test(raw))
    throw new UrlValidationError("invalid_url");
  let base: string | undefined;
  if (baseUrl !== undefined) base = normalizeRemoteUrl(baseUrl);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (/^(?:https?:)?\/\/[^/?#]*@/i.test(raw))
    throw new UrlValidationError("unsafe_url");
  if (hasScheme && /^https?:/i.test(raw) && !/^https?:\/\//i.test(raw))
    throw new UrlValidationError("invalid_url");
  if (!hasScheme && !base)
    throw new UrlValidationError("relative_without_base");
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new UrlValidationError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new UrlValidationError("unsupported_protocol");
  if (url.username || url.password) throw new UrlValidationError("unsafe_url");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    (!host.includes(".") && !host.includes(":")) ||
    /\.(localhost|local|localdomain|internal|lan|home|home\.arpa|test|invalid)$/.test(
      host,
    )
  )
    throw new UrlValidationError("unsafe_url");
  if (/^\d+(\.\d+){3}$/.test(host) && unsafeIPv4(host))
    throw new UrlValidationError("unsafe_url");
  if (host.includes(":") && unsafeIPv6(host))
    throw new UrlValidationError("unsafe_url");
  const port = Number(url.port || (url.protocol === "http:" ? 80 : 443));
  if ((port < 1024 && port !== 80 && port !== 443) || BLOCKED_PORTS.has(port))
    throw new UrlValidationError("unsafe_url");
  // WHATWG URL preserves query parameter order and token values. Do not use URLSearchParams.
  return url.toString();
}

export function safeHostname(input: string): string {
  try {
    return new URL(input).hostname;
  } catch {
    return "网络来源";
  }
}
