import React from "react";
import { TextDecoder as NodeTextDecoder } from "node:util";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { BackupControls } from "../src/features/settings/BackupControls";
import type { Repository } from "../src/data/repository";

const mockConfirm = jest.fn(),
  mockPick = jest.fn(),
  mockWrite = jest.fn(),
  mockDirectory = jest.fn(),
  mockCreate = jest.fn(),
  mockDelete = jest.fn();
const text = JSON.stringify({
  format: "jingkan-backup",
  version: 1,
  createdAt: 1,
  sources: [],
  channels: [],
  favorites: [],
  preferences: {
    mobileWarning: true,
    swipeReverse: false,
    skipUnreachable: true,
  },
});
const mockFile = {
  exists: true,
  size: 400,
  bytes: jest.fn(),
  delete: jest.fn(),
};
jest.mock("../src/features/common/confirm", () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: () => mockPick(),
}));
jest.mock("expo-file-system", () => ({ File: jest.fn(() => mockFile) }));
jest.mock("expo-file-system/legacy", () => ({
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: () => mockDirectory(),
    createFileAsync: (...args: unknown[]) => mockCreate(...args),
    writeAsStringAsync: (...args: unknown[]) => mockWrite(...args),
  },
  deleteAsync: (...args: unknown[]) => mockDelete(...args),
}));
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(globalThis, { TextDecoder: NodeTextDecoder });
  mockConfirm.mockResolvedValue(true);
  mockDirectory.mockResolvedValue({
    granted: true,
    directoryUri: "content://local/backups",
  });
  mockCreate.mockResolvedValue("content://local/backup.json");
  mockWrite.mockResolvedValue(undefined);
  mockPick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///cache/backup.json" }],
  });
  mockFile.bytes.mockResolvedValue(new TextEncoder().encode(text));
});
const setup = async () => {
  const exportBackup = jest.fn(async () => text),
    onRestore = jest.fn(async () => {});
  const ui = await render(
    <BackupControls
      repo={{ exportBackup } as unknown as Repository}
      onRestore={onRestore}
    />,
  );
  return { ui, exportBackup, onRestore };
};
test("declining sensitive export creates no file; accepting writes only to the chosen directory", async () => {
  const { ui, exportBackup } = await setup();
  mockConfirm.mockResolvedValueOnce(false);
  await fireEvent.press(ui.getByRole("button", { name: "导出备份" }));
  expect(mockDirectory).not.toHaveBeenCalled();
  expect(exportBackup).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: "导出备份" }));
  await waitFor(() =>
    expect(mockWrite).toHaveBeenCalledWith("content://local/backup.json", text),
  );
  expect(ui.getByText("备份已保存。请妥善保管此文件。")).toBeTruthy();
  await ui.unmount();
});
test("restore validates before confirmation and cleans only the picker cache on rejection or cancellation", async () => {
  const { ui, onRestore } = await setup();
  mockFile.bytes.mockResolvedValueOnce(new TextEncoder().encode("not JSON"));
  await fireEvent.press(ui.getByRole("button", { name: "从备份恢复" }));
  await waitFor(() => expect(mockFile.delete).toHaveBeenCalledTimes(1));
  expect(mockConfirm).not.toHaveBeenCalled();
  expect(onRestore).not.toHaveBeenCalled();
  mockConfirm.mockResolvedValueOnce(false);
  await fireEvent.press(ui.getByRole("button", { name: "从备份恢复" }));
  await waitFor(() => expect(mockFile.delete).toHaveBeenCalledTimes(2));
  expect(onRestore).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: "从备份恢复" }));
  await waitFor(() => expect(onRestore).toHaveBeenCalledWith(text));
  expect(
    ui.getByText("恢复完成。联网许可已重置，可先离线查看资料。"),
  ).toBeTruthy();
  await ui.unmount();
});
