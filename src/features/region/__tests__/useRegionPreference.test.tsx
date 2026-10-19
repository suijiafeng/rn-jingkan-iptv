import { AppState, type AppStateStatus } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { Repository } from "../../../data/repository";
import { detectRegion } from "../native";
import { answerConsent, currentConsent } from "../../common/ConsentDialog";
import {
  COUNTRY_PREFERENCE_KEY,
  useRegionPreference,
} from "../useRegionPreference";
import {
  DEFAULT_COUNTRY_PREFERENCE,
  type CountryPreference,
  type RegionResult,
} from "../policy";

jest.mock("../native", () => ({
  detectRegion: jest.fn(),
  readDeviceEvidence: jest.fn(() => ({
    region: "CN",
    language: "zh",
    timeZone: "Asia/Shanghai",
  })),
}));

const repo = { getSetting: jest.fn(), setSetting: jest.fn() };
const error = jest.fn();
let changeState: (state: AppStateStatus) => void;

beforeEach(() => {
  jest.clearAllMocks();
  repo.getSetting.mockImplementation(async (_key, fallback) => fallback);
  repo.setSetting.mockResolvedValue(undefined);
  (detectRegion as jest.Mock).mockResolvedValue({
    countryCode: "CN",
    source: "device",
    message: "设备推荐",
  });
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    writable: true,
    value: "active",
  });
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, callback) => {
      changeState = callback;
      return { remove: jest.fn() };
    });
});

function mount() {
  return renderHook(() =>
    useRegionPreference(repo as unknown as Repository, error),
  );
}

test("default startup reads local hints without requesting detection or consent", async () => {
  const { result } = await mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(repo.getSetting).toHaveBeenCalledWith(
    COUNTRY_PREFERENCE_KEY,
    DEFAULT_COUNTRY_PREFERENCE,
  );
  expect(result.current.result).toMatchObject({
    countryCode: "CN",
    source: "device",
  });
  expect(detectRegion).not.toHaveBeenCalled();
});

test("background cancellation cannot strand an unfinished preference read", async () => {
  let finish!: (value: CountryPreference) => void;
  repo.getSetting.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = await mount();
  await act(async () => {
    changeState("background");
    result.current.cancel();
  });
  await act(async () => {
    finish({ ...DEFAULT_COUNTRY_PREFERENCE, ipAllowed: true });
  });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(detectRegion).not.toHaveBeenCalled();
});

test("clearing all data invalidates a late initialization result", async () => {
  let finish!: (value: CountryPreference) => void;
  repo.getSetting.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = await mount();
  await act(async () => {
    result.current.reset();
  });
  await act(async () => {
    finish({
      mode: "manual",
      countryCode: "US",
      ipAllowed: true,
      locationAllowed: true,
    });
  });
  expect(result.current.ready).toBe(true);
  expect(result.current.preference).toEqual(DEFAULT_COUNTRY_PREFERENCE);
  expect(detectRegion).not.toHaveBeenCalled();
});

test("a saved manual all choice wins even when authorized auto lookup is available", async () => {
  repo.getSetting.mockResolvedValueOnce({
    mode: "manual",
    countryCode: null,
    ipAllowed: true,
    locationAllowed: true,
  });
  const { result } = await mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.preference.mode).toBe("manual");
  expect(detectRegion).not.toHaveBeenCalled();
});

test("manual selection aborts an in-flight lookup and rejects its late result", async () => {
  let finish!: (value: RegionResult) => void;
  repo.getSetting.mockResolvedValueOnce({
    ...DEFAULT_COUNTRY_PREFERENCE,
    ipAllowed: true,
  });
  (detectRegion as jest.Mock).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = await mount();
  await waitFor(() => expect(result.current.busy).toBe(true));
  const signal = (detectRegion as jest.Mock).mock.calls[0][0].signal;
  await act(async () => {
    await result.current.selectManualCountry(null);
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish({ countryCode: "US", source: "ip", message: "过期结果" });
  });
  expect(result.current.preference).toMatchObject({
    mode: "manual",
    countryCode: null,
  });
  expect(result.current.result.message).not.toContain("过期");
  expect(repo.setSetting).toHaveBeenLastCalledWith(
    COUNTRY_PREFERENCE_KEY,
    expect.objectContaining({ mode: "manual", countryCode: null }),
  );
});

test("concurrent manual writes finish in user order without stale UI updates", async () => {
  const { result } = await mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  let completeFirst!: () => void;
  repo.setSetting.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      completeFirst = resolve;
    }),
  );
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = result.current.selectManualCountry("US");
  });
  await waitFor(() => expect(repo.setSetting).toHaveBeenCalledTimes(1));
  await act(async () => {
    second = result.current.selectManualCountry("JP");
  });
  await act(async () => {
    completeFirst();
    await Promise.all([first, second]);
  });
  expect(repo.setSetting.mock.calls.map((call) => call[1].countryCode)).toEqual(
    ["US", "JP"],
  );
  expect(result.current.preference).toMatchObject({
    mode: "manual",
    countryCode: "JP",
  });
});

test("failed manual persistence keeps the previous choice and reports the error", async () => {
  const { result } = await mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  repo.setSetting.mockRejectedValueOnce(new Error("SQLite unavailable"));
  await act(async () => {
    await result.current.selectManualCountry("US");
  });
  expect(result.current.preference).toEqual(DEFAULT_COUNTRY_PREFERENCE);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("未保存"));
});

test("a failed later manual write displays the earlier choice that actually committed", async () => {
  const { result } = await mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  let finishFirst!: () => void;
  repo.setSetting.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishFirst = resolve;
    }),
  );
  repo.setSetting.mockRejectedValueOnce(new Error("second write failed"));
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = result.current.selectManualCountry("US");
  });
  await waitFor(() => expect(repo.setSetting).toHaveBeenCalledTimes(1));
  await act(async () => {
    second = result.current.selectManualCountry("JP");
  });
  await act(async () => {
    finishFirst();
    await Promise.all([first, second]);
  });
  expect(result.current.preference).toMatchObject({
    mode: "manual",
    countryCode: "US",
  });
  expect(error).toHaveBeenCalledWith(expect.stringContaining("未保存"));
});

test("separate consent identifies the IP provider and location processing before querying", async () => {
  const { result } = await mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  let task!: Promise<void>;
  await act(async () => {
    task = result.current.detectWithConsent();
  });
  // The full text is folded in the dialog, not shortened.
  expect(currentConsent()?.details).toContain("ipapi.co");
  expect(currentConsent()?.points).toContain("ipapi.co 会看到你的 IP");
  expect(detectRegion).not.toHaveBeenCalled();
  await act(async () => answerConsent("allow"));
  expect(currentConsent()?.details).toContain("反向地理编码");
  expect(currentConsent()?.details).toContain("不启用后台定位");
  expect(detectRegion).not.toHaveBeenCalled();
  await act(async () => {
    answerConsent("skip");
    await task;
  });
  expect(detectRegion).toHaveBeenCalledWith(
    expect.objectContaining({
      ipAllowed: true,
      locationAllowed: false,
      requestLocationPermission: false,
    }),
  );
  expect(result.current.preference.ipAllowed).toBe(true);
  expect(result.current.preference.locationAllowed).toBe(false);
});

test("dismissed consent starts no lookup and writes no permission", async () => {
  const { result } = await mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  let task!: Promise<void>;
  await act(async () => {
    task = result.current.detectWithConsent();
  });
  await act(async () => {
    answerConsent(currentConsent()!.dismissValue);
    await task;
  });
  expect(detectRegion).not.toHaveBeenCalled();
  expect(repo.setSetting).not.toHaveBeenCalled();
});

test("failed revocation stops trusting consent and exposes a working persistence retry", async () => {
  repo.getSetting.mockResolvedValueOnce({
    mode: "manual",
    countryCode: null,
    ipAllowed: true,
    locationAllowed: true,
  });
  const { result } = await mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  repo.setSetting.mockRejectedValueOnce(new Error("database unavailable"));
  await act(async () => {
    await result.current.revokeConsent();
  });
  expect(result.current.preference).toMatchObject({
    ipAllowed: false,
    locationAllowed: false,
  });
  expect(result.current.revokePending).toBe(true);
  await act(async () => {
    await result.current.detectWithConsent();
  });
  expect(detectRegion).not.toHaveBeenCalled();
  expect(error).toHaveBeenLastCalledWith(expect.stringContaining("先重试"));
  await act(async () => {
    await result.current.revokeConsent();
  });
  expect(result.current.revokePending).toBe(false);
  expect(repo.setSetting).toHaveBeenLastCalledWith(
    COUNTRY_PREFERENCE_KEY,
    expect.objectContaining({ ipAllowed: false, locationAllowed: false }),
  );
});

test("backgrounding aborts lookup and reset clears session consent", async () => {
  repo.getSetting.mockResolvedValueOnce({
    ...DEFAULT_COUNTRY_PREFERENCE,
    ipAllowed: true,
  });
  (detectRegion as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
  const { result } = await mount();
  await waitFor(() => expect(result.current.busy).toBe(true));
  const signal = (detectRegion as jest.Mock).mock.calls[0][0].signal;
  await act(async () => {
    changeState("background");
  });
  expect(signal.aborted).toBe(true);
  expect(result.current.busy).toBe(false);
  await act(async () => {
    result.current.reset();
  });
  expect(result.current.preference).toEqual(DEFAULT_COUNTRY_PREFERENCE);
  expect(result.current.revokePending).toBe(false);
});
