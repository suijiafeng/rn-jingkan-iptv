import * as Localization from "expo-localization";
import * as Location from "expo-location";
import { isCountryCode } from "../../domain/channelFacets";
import { linkedDeadline } from "../../lib/abort";
import {
  resolveRegion,
  type DeviceEvidence,
  type RegionResult,
} from "./policy";

const IP_ENDPOINT = "https://ipapi.co/country/";
export const IP_TIMEOUT_MS = 4500;
export const LOCATION_TIMEOUT_MS = 10000;

export class RegionLookupError extends Error {
  constructor(
    public readonly code:
      | "cancelled"
      | "timeout"
      | "unavailable"
      | "denied"
      | "network"
      | "invalid",
  ) {
    super(code);
    this.name = "RegionLookupError";
  }
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new RegionLookupError("cancelled");
}

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new RegionLookupError("cancelled"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new RegionLookupError("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    task
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A shared deadline plus this module's error vocabulary. */
function deadline(parent: AbortSignal, milliseconds: number) {
  const limit = linkedDeadline(parent, milliseconds);
  return {
    signal: limit.signal,
    error(error: unknown): Error {
      if (parent.aborted) return new RegionLookupError("cancelled");
      if (limit.timedOut) return new RegionLookupError("timeout");
      return error instanceof RegionLookupError
        ? error
        : new RegionLookupError("unavailable");
    },
    close: limit.close,
  };
}

export function readDeviceEvidence(): DeviceEvidence {
  let region: string | null = null;
  let language: string | null = null;
  let timeZone: string | null = null;
  try {
    const locale = Localization.getLocales()?.[0];
    const candidate = locale?.regionCode?.toUpperCase();
    region = isCountryCode(candidate) ? candidate : null;
    language =
      typeof locale?.languageCode === "string" ? locale.languageCode : null;
  } catch {
    /* Local configuration can be absent on unsupported devices. */
  }
  try {
    const candidate = Localization.getCalendars()?.[0]?.timeZone;
    timeZone = typeof candidate === "string" ? candidate : null;
  } catch {
    /* No time-zone hint is safer than an inferred UTC offset. */
  }
  return { region, language, timeZone };
}

export async function lookupIpCountry(parent: AbortSignal): Promise<string> {
  const limit = deadline(parent, IP_TIMEOUT_MS);
  try {
    assertActive(limit.signal);
    const response = await abortable(
      fetch(IP_ENDPOINT, {
        method: "GET",
        headers: { Accept: "text/plain" },
        credentials: "omit",
        signal: limit.signal,
      }),
      limit.signal,
    );
    assertActive(limit.signal);
    if (!response.ok) throw new RegionLookupError("network");
    const length = response.headers?.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > 16))
      throw new RegionLookupError("invalid");
    const text = await abortable(response.text(), limit.signal);
    assertActive(limit.signal);
    if (text.length > 16 || !isCountryCode(text.trim()))
      throw new RegionLookupError("invalid");
    return text.trim();
  } catch (error) {
    throw limit.error(error);
  } finally {
    limit.close();
  }
}

export async function lookupLocationCountry(
  parent: AbortSignal,
  requestPermission: boolean,
): Promise<string> {
  const limit = deadline(parent, LOCATION_TIMEOUT_MS);
  const watcher: { subscription: Location.LocationSubscription | null } = {
    subscription: null,
  };
  let positionFinished = false;
  const task = async (): Promise<string> => {
    assertActive(limit.signal);
    if (!(await Location.hasServicesEnabledAsync()))
      throw new RegionLookupError("unavailable");
    assertActive(limit.signal);
    const permission = requestPermission
      ? await Location.requestForegroundPermissionsAsync()
      : await Location.getForegroundPermissionsAsync();
    assertActive(limit.signal);
    if (!permission.granted) throw new RegionLookupError("denied");
    const position = await new Promise<Location.LocationObject>(
      (resolve, reject) => {
        Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Lowest,
            mayShowUserSettingsDialog: false,
          },
          (value) => {
            positionFinished = true;
            watcher.subscription?.remove();
            watcher.subscription = null;
            resolve(value);
          },
          () => {
            positionFinished = true;
            watcher.subscription?.remove();
            watcher.subscription = null;
            reject(new RegionLookupError("unavailable"));
          },
        ).then((created) => {
          if (positionFinished || limit.signal.aborted) created.remove();
          else watcher.subscription = created;
        }, reject);
      },
    );
    assertActive(limit.signal);
    // Coordinates remain in this call only; the OS geocoder returns a country.
    const addresses = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
    assertActive(limit.signal);
    const country = addresses[0]?.isoCountryCode?.toUpperCase();
    if (!isCountryCode(country)) throw new RegionLookupError("invalid");
    return country;
  };
  try {
    return await abortable(task(), limit.signal);
  } catch (error) {
    throw limit.error(error);
  } finally {
    positionFinished = true;
    watcher.subscription?.remove();
    limit.close();
  }
}

export interface RegionDetectionOptions {
  ipAllowed: boolean;
  locationAllowed: boolean;
  requestLocationPermission: boolean;
  signal: AbortSignal;
}

export async function detectRegion(
  options: RegionDetectionOptions,
): Promise<RegionResult> {
  const device = readDeviceEvidence();
  assertActive(options.signal);
  const [ip, location] = await Promise.allSettled([
    options.ipAllowed ? lookupIpCountry(options.signal) : Promise.resolve(null),
    options.locationAllowed
      ? lookupLocationCountry(options.signal, options.requestLocationPermission)
      : Promise.resolve(null),
  ]);
  assertActive(options.signal);
  const result = resolveRegion(
    device,
    ip.status === "fulfilled" ? ip.value : null,
    location.status === "fulfilled" ? location.value : null,
  );
  const issues: string[] = [];
  if (ip.status === "rejected") issues.push("网络位置查询未完成");
  if (location.status === "rejected")
    issues.push(
      location.reason instanceof RegionLookupError &&
        location.reason.code === "denied"
        ? "未获得手机定位权限"
        : "手机位置暂不可用",
    );
  return issues.length
    ? { ...result, message: `${issues.join("，")}；${result.message}` }
    : result;
}
