import * as Location from "expo-location";
import {
  detectRegion,
  IP_TIMEOUT_MS,
  lookupIpCountry,
  lookupLocationCountry,
  readDeviceEvidence,
} from "../native";

jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ regionCode: "CN", languageCode: "zh" }]),
  getCalendars: jest.fn(() => [{ timeZone: "Asia/Shanghai" }]),
}));
jest.mock("expo-location", () => ({
  Accuracy: { Lowest: 1 },
  hasServicesEnabledAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const originalFetch = global.fetch;
const mockFetch = jest.fn();
const granted = { granted: true };

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
  (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValue(true);
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue(
    granted,
  );
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(
    granted,
  );
  (Location.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
    { isoCountryCode: "CN" },
  ]);
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

function response(text: string, ok = true, length: string | null = null) {
  return {
    ok,
    headers: { get: () => length },
    text: jest.fn(async () => text),
  };
}

test("local-only detection performs no network or location request", async () => {
  expect(readDeviceEvidence()).toEqual({
    region: "CN",
    language: "zh",
    timeZone: "Asia/Shanghai",
  });
  const result = await detectRegion({
    ipAllowed: false,
    locationAllowed: false,
    requestLocationPermission: false,
    signal: new AbortController().signal,
  });
  expect(result.countryCode).toBe("CN");
  expect(mockFetch).not.toHaveBeenCalled();
  expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test("IP lookup uses only the fixed HTTPS country endpoint without credentials", async () => {
  mockFetch.mockResolvedValueOnce(response("CN\n"));
  await expect(lookupIpCountry(new AbortController().signal)).resolves.toBe(
    "CN",
  );
  expect(mockFetch).toHaveBeenCalledWith(
    "https://ipapi.co/country/",
    expect.objectContaining({ credentials: "omit", method: "GET" }),
  );
});

test.each([
  response("rate limited", false),
  response("ZZ"),
  response("CN", true, "2048"),
  response("CN".repeat(100)),
])(
  "malformed, oversized and failed IP responses are rejected",
  async (value) => {
    mockFetch.mockResolvedValueOnce(value);
    await expect(
      lookupIpCountry(new AbortController().signal),
    ).rejects.toHaveProperty("code");
  },
);

test("an IP timeout aborts the pending request", async () => {
  jest.useFakeTimers();
  mockFetch.mockReturnValueOnce(new Promise(() => {}));
  const lookup = lookupIpCountry(new AbortController().signal);
  const assertion = expect(lookup).rejects.toMatchObject({ code: "timeout" });
  await jest.advanceTimersByTimeAsync(IP_TIMEOUT_MS);
  await assertion;
  expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
});

test("denied existing location permission never causes a new system prompt at startup", async () => {
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
    granted: false,
  });
  await expect(
    lookupLocationCountry(new AbortController().signal, false),
  ).rejects.toMatchObject({ code: "denied" });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

test("one location fix stops the watcher before resolving a country", async () => {
  const remove = jest.fn();
  (Location.watchPositionAsync as jest.Mock).mockImplementationOnce(
    async (_options, callback) => {
      callback({ coords: { latitude: 30, longitude: 120 } });
      return { remove };
    },
  );
  await expect(
    lookupLocationCountry(new AbortController().signal, true),
  ).resolves.toBe("CN");
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(Location.watchPositionAsync).toHaveBeenCalledWith(
    expect.objectContaining({ accuracy: 1, mayShowUserSettingsDialog: false }),
    expect.any(Function),
    expect.any(Function),
  );
});

test("cancellation removes a watcher even if native registration finishes later", async () => {
  const request = new AbortController();
  let register!: (value: { remove: jest.Mock }) => void;
  let started!: () => void;
  const watching = new Promise<void>((resolve) => {
    started = resolve;
  });
  const remove = jest.fn();
  (Location.watchPositionAsync as jest.Mock).mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      register = resolve;
    });
  });
  const lookup = lookupLocationCountry(request.signal, false);
  await watching;
  request.abort();
  await expect(lookup).rejects.toMatchObject({ code: "cancelled" });
  register({ remove });
  await Promise.resolve();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(Location.reverseGeocodeAsync).not.toHaveBeenCalled();
});

test("service errors are contained and retain the device-only fallback", async () => {
  mockFetch.mockRejectedValueOnce(
    new Error("private response must not escape"),
  );
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
    granted: false,
  });
  const result = await detectRegion({
    ipAllowed: true,
    locationAllowed: true,
    requestLocationPermission: false,
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({ countryCode: "CN", source: "device" });
  expect(result.message).toContain("网络位置查询未完成");
  expect(result.message).toContain("未获得手机定位权限");
  expect(result.message).not.toContain("private");
});
