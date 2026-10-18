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
  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  )
    return true;
  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 &&
      (second === 168 || second === 0 || (second === 88 && third === 99))) ||
    (first === 198 &&
      (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113)
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

// Streaming servers commonly use non-standard low ports (81, 82, 85, 98...),
// so only well-known non-HTTP service ports are refused: the WHATWG Fetch
// "bad port" list plus common LAN/database/admin services.
const BLOCKED_PORTS = new Set([
  // WHATWG Fetch bad ports
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
  // Additional LAN, container, database and remote-desktop services
  445, 1900, 2375, 2376, 3306, 3389, 5353, 5432, 5900, 6379, 9200, 11211,
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
  if (BLOCKED_PORTS.has(port)) throw new UrlValidationError("unsafe_url");
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
