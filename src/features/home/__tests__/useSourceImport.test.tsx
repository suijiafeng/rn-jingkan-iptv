import * as DocumentPicker from "expo-document-picker";
import { act, renderHook } from "@testing-library/react-native";
import type { Repository } from "../../../data/repository";
import type { Source } from "../../../domain/types";
import { readPickedFile } from "../../../data/importIO";
import { confirm } from "../../common/confirm";
import { useSourceImport } from "../useSourceImport";

jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("../../../data/importIO", () => ({
  ...jest.requireActual("../../../data/importIO"),
  readPickedFile: jest.fn(),
}));
jest.mock("../../common/confirm", () => ({ confirm: jest.fn() }));

const repo = {
  beginRefresh: jest.fn(),
  cancelRefresh: jest.fn(),
  getSourceContent: jest.fn(),
  importSource: jest.fn(),
};
const source = {
  id: "s1",
  name: "家里",
  kind: "file",
  location: "home.m3u",
} as Source;

async function mount() {
  const onReturnToManagement = jest.fn(),
    onFillLanguages = jest.fn(),
    setError = jest.fn();
  const hook = await renderHook(() =>
    useSourceImport({
      repo: repo as unknown as Repository,
      setError,
      mounted: { current: true },
      remoteRef: { current: false },
      guardRemote: async () => true,
      checkNetwork: async () => true,
      reconcilePlayingSources: async () => undefined,
      changed: jest.fn(),
      onImported: jest.fn(),
      onReturnToManagement,
      onFillLanguages,
    }),
  );
  return { ...hook, onReturnToManagement, onFillLanguages, setError };
}

const pick = (name: string) =>
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: `file:///${name}`, name }],
  });

beforeEach(() => {
  jest.clearAllMocks();
  (confirm as jest.Mock).mockResolvedValue(true);
  repo.beginRefresh.mockResolvedValue({ sourceId: "s1", token: "t" });
  repo.getSourceContent.mockResolvedValue("#EXTM3U");
});

test("a successfully read file clears the previous read error", async () => {
  const { result } = await mount();
  await act(async () => {
    result.current.startForm("file");
  });
  pick("broken.m3u");
  (readPickedFile as jest.Mock).mockRejectedValueOnce(new Error("bad"));
  await act(async () => result.current.chooseFile());
  expect(result.current.formError).toMatch("文件无法打开");
  pick("good.m3u");
  (readPickedFile as jest.Mock).mockResolvedValueOnce("#EXTM3U");
  await act(async () => result.current.chooseFile());
  expect(result.current.formError).toBe("");
  expect(result.current.form?.fileName).toBe("good.m3u");
});

test("cancelling a form opened from management returns there", async () => {
  const { result, onReturnToManagement } = await mount();
  await act(async () => {
    result.current.startForm("url", true);
  });
  await act(async () => result.current.closeForm());
  expect(result.current.form).toBeNull();
  expect(onReturnToManagement).toHaveBeenCalledTimes(1);

  await act(async () => result.current.refresh(source, true));
  await act(async () => result.current.closeForm());
  expect(repo.cancelRefresh).toHaveBeenCalledWith("s1");
  expect(onReturnToManagement).toHaveBeenCalledTimes(2);
});

test("a kept form or one opened elsewhere stays out of management", async () => {
  const { result, onReturnToManagement } = await mount();
  await act(async () => {
    result.current.startForm("url", true);
  });
  await act(async () => {
    result.current.updateForm({ url: "https://example.test/a.m3u" });
  });
  (confirm as jest.Mock).mockResolvedValueOnce(false);
  await act(async () => result.current.closeForm());
  expect(result.current.form).not.toBeNull();
  expect(onReturnToManagement).not.toHaveBeenCalled();

  await act(async () => {
    result.current.startForm("url");
  });
  await act(async () => result.current.closeForm());
  expect(onReturnToManagement).not.toHaveBeenCalled();
});

test("a refresh that cannot start from management shows its error there", async () => {
  const { result, onReturnToManagement, setError } = await mount();
  repo.beginRefresh.mockRejectedValueOnce(new Error("busy"));
  await act(async () => result.current.refresh(source, true));
  expect(setError).toHaveBeenLastCalledWith(
    "该来源正在刷新或已删除，请稍后重试",
  );
  expect(onReturnToManagement).toHaveBeenCalledTimes(1);
});

describe("languages after saving", () => {
  const fileImport = async (tvgId: string | null, fillLanguages: boolean) => {
    const mounted = await mount();
    repo.importSource.mockResolvedValueOnce({ id: "new" });
    await act(async () => {
      mounted.result.current.startForm("file");
    });
    pick("list.m3u");
    (readPickedFile as jest.Mock).mockResolvedValueOnce(
      `#EXTM3U\n#EXTINF:-1 ${tvgId ? `tvg-id="${tvgId}"` : ""},频道\nhttps://example.com/a.m3u8\n`,
    );
    await act(async () => mounted.result.current.chooseFile());
    await act(async () => mounted.result.current.preview());
    expect(mounted.result.current.formError).toBe("");
    expect(mounted.result.current.form?.preview).toBeTruthy();
    await act(async () => {
      mounted.result.current.setFillLanguages(fillLanguages);
    });
    // The switch must not throw the preview away.
    expect(mounted.result.current.form?.preview).toBeTruthy();
    await act(async () => mounted.result.current.save());
    return mounted;
  };

  test("an iptv-org list fills its languages once saved", async () => {
    const { onFillLanguages } = await fileImport("CCTV1.cn@SD", true);
    expect(onFillLanguages).toHaveBeenCalledWith("new");
  });

  test("switched off, nothing goes online", async () => {
    const { onFillLanguages } = await fileImport("CCTV1.cn@SD", false);
    expect(repo.importSource).toHaveBeenCalled();
    expect(onFillLanguages).not.toHaveBeenCalled();
  });

  test("a list without iptv-org ids never asks", async () => {
    const { onFillLanguages } = await fileImport(null, true);
    expect(onFillLanguages).not.toHaveBeenCalled();
  });
});
