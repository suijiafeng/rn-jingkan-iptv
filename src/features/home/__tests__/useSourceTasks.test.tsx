import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import * as Network from "expo-network";
import type { Repository } from "../../../data/repository";
import type { Source } from "../../../domain/types";
import { checkAvailability } from "../../source/availabilityCoordinator";
import {
  LanguageLookupError,
  lookupIptvOrgLanguages,
} from "../../source/iptvOrgLanguages";
import { useSourceTasks } from "../useSourceTasks";

jest.mock("expo-network", () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock("../../source/availabilityCoordinator", () => ({
  ...jest.requireActual("../../source/availabilityCoordinator"),
  checkAvailability: jest.fn(),
}));
jest.mock("../../source/iptvOrgLanguages", () => ({
  ...jest.requireActual("../../source/iptvOrgLanguages"),
  lookupIptvOrgLanguages: jest.fn(),
}));

const repo = {
  listChannels: jest.fn(),
  listLanguageLookupTargets: jest.fn(),
  saveLookedUpLanguages: jest.fn(),
};

async function mount() {
  const setError = jest.fn(),
    changed = jest.fn(),
    checkNetwork = jest.fn(async () => true);
  const hook = await renderHook(() =>
    useSourceTasks({
      repo: repo as unknown as Repository,
      setError,
      mounted: { current: true },
      remoteRef: { current: true },
      permissionEpoch: { current: 0 },
      guardRemote: async () => true,
      checkNetwork,
      changed,
    }),
  );
  return { ...hook, setError, changed, checkNetwork };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.listChannels.mockResolvedValue([]);
  // The repository already narrows to unlabelled iptv-org rows.
  repo.listLanguageLookupTargets.mockResolvedValue([
    { id: "c1", tvgId: "CCTV1.cn@SD" },
  ]);
  repo.saveLookedUpLanguages.mockResolvedValue(1);
});

test("the repository's lookup targets are looked up and saved", async () => {
  (lookupIptvOrgLanguages as jest.Mock).mockResolvedValueOnce(
    new Map([["CCTV1.cn@SD", ["zh"]]]),
  );
  const { result, changed, setError, checkNetwork } = await mount();
  await act(async () => result.current.runLanguageLookup("s1"));
  expect(checkNetwork).toHaveBeenCalled();
  expect([...(lookupIptvOrgLanguages as jest.Mock).mock.calls[0][0]]).toEqual([
    "CCTV1.cn@SD",
  ]);
  expect(repo.saveLookedUpLanguages).toHaveBeenCalledWith([
    { channelId: "c1", tvgId: "CCTV1.cn@SD", languages: ["zh"] },
  ]);
  expect(changed).toHaveBeenCalled();
  expect(setError).not.toHaveBeenCalled();
  expect(result.current.languageLookup).toBeNull();
});

test("a failed lookup says the channels are in but languages are not", async () => {
  (lookupIptvOrgLanguages as jest.Mock).mockRejectedValueOnce(
    new LanguageLookupError("语言数据库下载超时，请检查网络后重试"),
  );
  const { result, setError } = await mount();
  await act(async () => result.current.runLanguageLookup("s1"));
  expect(setError).toHaveBeenCalledWith(
    "频道已导入，语言未补全：语言数据库下载超时，请检查网络后重试",
  );
  expect(repo.saveLookedUpLanguages).not.toHaveBeenCalled();
});

test("declining mobile data downloads nothing", async () => {
  const { result, checkNetwork } = await mount();
  checkNetwork.mockResolvedValueOnce(false);
  await act(async () => result.current.runLanguageLookup("s1"));
  expect(lookupIptvOrgLanguages).not.toHaveBeenCalled();
});

test.each([
  ["WIFI", 8],
  ["ETHERNET", 8],
  ["CELLULAR", 4],
  ["VPN", 4],
])("a manual check on %s probes %i addresses at once", async (type, width) => {
  (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({
    type,
    isConnected: true,
  });
  // Runs the preflight like the real coordinator, then reads the width.
  (checkAvailability as jest.Mock).mockImplementation(
    async (_store, _targets, sweep) => {
      await sweep.beforeRequests();
      return { results: [], refreshed: false, width: sweep.concurrency() };
    },
  );
  // Checks only run while the app is in front.
  Object.defineProperty(AppState, "currentState", {
    value: "active",
    configurable: true,
  });
  const { result } = await mount();
  await act(async () => result.current.runCheck({ id: "s1" } as Source));
  const sweep = (checkAvailability as jest.Mock).mock.results[0].value;
  expect((await sweep).width).toBe(width);
});
