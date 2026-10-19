import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { StorageAccessFramework, deleteAsync } from "expo-file-system/legacy";
import type { Repository } from "../../data/repository";
import { BackupError, MAX_BACKUP_BYTES, parseBackup } from "../../data/backup";
import { Button } from "../../components/ui";
import { styles } from "../../theme";
import { confirm } from "../common/confirm";

export function BackupControls({
  repo,
  onRestore,
}: {
  repo: Repository;
  onRestore: (text: string) => Promise<void>;
}) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const run = async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (error) {
      setMessage(
        error instanceof BackupError
          ? error.message
          : "操作未完成，请检查文件权限和存储空间后重试。",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const exportFile = () =>
    run(async () => {
      if (
        !(await confirm(
          "导出本机备份？",
          "备份是未加密的 JSON，包含节目源完整地址、令牌、本地节目单、收藏和播放偏好。请保存在自己的安全目录，不要公开分享。观看记录和所有联网许可不导出。",
          "选择保存目录",
        ))
      )
        return;
      const permission =
        await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permission.granted) return;
      const text = await repo.exportBackup();
      const uri = await StorageAccessFramework.createFileAsync(
        permission.directoryUri,
        `jingkan-backup-${Date.now()}.json`,
        "application/json",
      );
      try {
        await StorageAccessFramework.writeAsStringAsync(uri, text);
      } catch (error) {
        try {
          await deleteAsync(uri, { idempotent: true });
        } catch {
          /* The provider may reject cleanup of a partial file. */
        }
        throw error;
      }
      setMessage("备份已保存。请妥善保管此文件。");
    });
  const restoreFile = () =>
    run(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/plain", "application/octet-stream"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0],
        file = new File(asset.uri);
      try {
        if (!file.exists || file.size > MAX_BACKUP_BYTES)
          throw new BackupError("文件不可访问或超过 32 MiB 上限。");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.bytes(),
        );
        const backup = parseBackup(text);
        if (
          !(await confirm(
            "用备份替换本机资料？",
            `备份包含 ${backup.sources.length} 份节目单、${backup.channels.length} 条播放地址、${backup.favorites.length} 个收藏。当前节目单、收藏、观看记录和设置将被替换。建议先导出当前资料；恢复后需重新允许联网、台标及地区识别。`,
            "替换并恢复",
          ))
        )
          return;
        await onRestore(text);
        setMessage("恢复完成。联网许可已重置，可先离线查看资料。");
      } finally {
        try {
          if (file.exists) file.delete();
        } catch {
          /* Only the picker cache copy is touched. */
        }
      }
    });
  return (
    <View style={{ padding: 16, gap: 10 }}>
      <Button
        label={busy ? "正在处理备份…" : "导出备份"}
        disabled={busy}
        secondary
        onPress={() => void exportFile()}
      />
      <Button
        label="从备份恢复"
        disabled={busy}
        secondary
        onPress={() => void restoreFile()}
      />
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.caption}>
          {message}
        </Text>
      )}
    </View>
  );
}
