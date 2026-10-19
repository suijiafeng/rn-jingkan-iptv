import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import * as DocumentPicker from "expo-document-picker";
import type { Repository } from "../../data/repository";
import type { Source, SourceKind } from "../../domain/types";
import { MAX_MIB, parseM3U } from "../../domain/m3u";
import {
  downloadPlaylist,
  ImportIOError,
  readPickedFile,
} from "../../data/importIO";
import { confirm } from "../common/confirm";
import { initialForm, type SourceFormState } from "../source/form";

/**
 * The add/refresh playlist form: pick or download, preview the parse, then
 * save in one transaction. Only the newest task may update the form.
 */
export function useSourceImport({
  repo,
  setError,
  mounted,
  remoteRef,
  guardRemote,
  checkNetwork,
  reconcilePlayingSources,
  changed,
  onImported,
  onReturnToManagement,
}: {
  repo: Repository | null;
  setError: (message: string) => void;
  mounted: MutableRefObject<boolean>;
  remoteRef: MutableRefObject<boolean>;
  guardRemote: () => Promise<boolean>;
  checkNetwork: () => Promise<boolean>;
  reconcilePlayingSources: () => Promise<void>;
  changed: () => void;
  /** A saved import or refresh shows the whole channel list again. */
  onImported: () => void;
  /** A cancelled form opened from source management goes back there. */
  onReturnToManagement: () => void;
}) {
  const [form, setForm] = useState<SourceFormState | null>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    saving = useRef(false),
    fromManagement = useRef(false);

  useEffect(() => () => controller.current?.abort(), []);

  const cancelTask = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }, []);
  const taskRunning = useCallback(() => controller.current !== null, []);

  const startForm = (kind: SourceKind, openedFromManagement = false) => {
    fromManagement.current = openedFromManagement;
    setError("");
    setForm(initialForm(kind));
    setFormError("");
  };
  const updateForm = (patch: Partial<SourceFormState>) =>
    setForm((current) =>
      current ? { ...current, ...patch, preview: null } : current,
    );

  const closeForm = async () => {
    if (saving.current) return;
    if (
      form &&
      (form.name || form.url || form.content || busy) &&
      !(await confirm(
        "放弃这次导入？",
        "尚未保存的输入与预览会被丢弃，已有频道不受影响。",
        "放弃",
      ))
    )
      return;
    cancelTask();
    if (form?.refresh) repo?.cancelRefresh(form.refresh.sourceId);
    setForm(null);
    setFormError("");
    if (fromManagement.current) {
      fromManagement.current = false;
      onReturnToManagement();
    }
  };

  const chooseFile = async () => {
    if (busy) return;
    const task = ++generation.current;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "audio/x-mpegurl",
          "application/vnd.apple.mpegurl",
          "text/plain",
          "application/octet-stream",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || task !== generation.current) return;
      const asset = result.assets[0];
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      const content = await readPickedFile(asset.uri, abort.signal);
      if (task === generation.current) {
        updateForm({ content, fileName: asset.name, kind: "file" });
        setFormError("");
      }
    } catch {
      if (task === generation.current)
        setFormError(
          `文件读取失败或超过 ${MAX_MIB} MiB，请选择 UTF-8 或 GBK 编码的 M3U、TXT 节目单。`,
        );
    } finally {
      if (task === generation.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  };

  const preview = async () => {
    if (!form || busy) return;
    const snapshot = form;
    const task = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setFormError("");
    try {
      let text = snapshot.content,
        baseUrl: string | undefined;
      if (snapshot.kind === "url") {
        if (!(await guardRemote()) || task !== generation.current) return;
        if (!(await checkNetwork()) || task !== generation.current) return;
        const downloaded = await downloadPlaylist(
          snapshot.url.trim(),
          abort.signal,
          remoteRef.current,
        );
        text = downloaded.text;
        baseUrl = downloaded.url;
      } else if (!text) throw new ImportIOError("请先选择文件");
      const parsed = await parseM3U(text, { baseUrl, signal: abort.signal });
      if (task !== generation.current || abort.signal.aborted) return;
      setForm((current) =>
        current ? { ...current, preview: parsed } : current,
      );
    } catch (failure) {
      if (task === generation.current) {
        setFormError(
          failure instanceof Error
            ? failure.message
            : "无法解析节目单，请检查后重试",
        );
        if (snapshot.refresh && !abort.signal.aborted)
          void repo
            ?.setSourceError(
              snapshot.refresh.sourceId,
              "refresh_failed",
              snapshot.refresh.revision,
            )
            .then(changed)
            .catch(() => {});
      }
    } finally {
      if (task === generation.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  };

  const save = async () => {
    if (!repo || !form?.preview || saving.current) return;
    saving.current = true;
    setBusy(true);
    const submitted = form;
    try {
      if (submitted.refresh) {
        await repo.refreshSource(
          submitted.refresh.sourceId,
          submitted.refresh.revision,
          submitted.preview!,
          {
            generation: submitted.refresh.generation,
            content: submitted.kind === "file" ? submitted.content : undefined,
            location:
              submitted.kind === "file" ? submitted.fileName : undefined,
          },
        );
        try {
          await reconcilePlayingSources();
        } catch {
          if (mounted.current)
            setError(
              "节目单已保存，但播放器来源列表更新失败，请重新打开频道。",
            );
        }
      } else {
        const name =
          submitted.name.trim() ||
          (submitted.kind === "file"
            ? submitted.fileName
            : new URL(submitted.url).hostname);
        await repo.importSource({
          name,
          kind: submitted.kind,
          location:
            submitted.kind === "file"
              ? submitted.fileName
              : submitted.url.trim(),
          preview: submitted.preview!,
          content: submitted.kind === "file" ? submitted.content : undefined,
        });
      }
      setForm(null);
      fromManagement.current = false;
      onImported();
      changed();
    } catch {
      setFormError("保存失败，旧数据未改变。请重试；刷新冲突时请重新刷新。");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  /** Opens the form pre-filled for a refresh, holding the source's token. */
  const refresh = async (source: Source, openedFromManagement = false) => {
    if (!repo || busy) return;
    fromManagement.current = openedFromManagement;
    setError("");
    try {
      const token = await repo.beginRefresh(source.id);
      const content =
        source.kind === "file"
          ? (await repo.getSourceContent(source.id)) || ""
          : "";
      setForm({
        ...initialForm(source.kind),
        name: source.name,
        url: source.kind === "url" ? source.location : "",
        fileName: source.kind === "file" ? source.location : "",
        content,
        refresh: token,
      });
      setFormError("");
    } catch {
      setError("这个来源正在刷新或已经被删除");
      if (openedFromManagement) {
        fromManagement.current = false;
        onReturnToManagement();
      }
    }
  };

  return {
    form,
    busy,
    formError,
    startForm,
    updateForm,
    closeForm,
    chooseFile,
    preview,
    save,
    refresh,
    cancelTask,
    taskRunning,
  };
}

export type SourceImport = ReturnType<typeof useSourceImport>;
