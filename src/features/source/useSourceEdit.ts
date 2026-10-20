import { useEffect, useRef, useState, type MutableRefObject } from "react";
import * as DocumentPicker from "expo-document-picker";
import type { Repository } from "../../data/repository";
import {
  downloadPlaylist,
  ImportIOError,
  readPickedFile,
} from "../../data/importIO";
import { M3UParseError, MAX_MIB, parseM3U } from "../../domain/m3u";
import type { Source } from "../../domain/types";
import type { SourceLanguages } from "../../data/sourceLanguages";

/** What the edit page needs from the app to go online and to report back. */
export interface SourceEditDeps {
  mounted: MutableRefObject<boolean>;
  remoteRef: MutableRefObject<boolean>;
  guardRemote: () => Promise<boolean>;
  checkNetwork: () => Promise<boolean>;
  reconcilePlayingSources: () => Promise<void>;
}

/**
 * Editing one source in a single save: its name, its link (or, for a
 * local list, its file), and the languages the user gives it and its groups. A new link or file is read and its channels
 * replace the old ones in one transaction; nothing changes if that fails.
 * Unchanged fields are left alone, so saving a new name never goes online.
 */
export function useSourceEdit({
  repo,
  source,
  close,
  changed,
  deps,
}: {
  repo: Repository;
  /** The page is mounted per source (keyed), so it starts from its values. */
  source: Source;
  close: () => void;
  changed: () => void;
  deps: SourceEditDeps;
}) {
  const [name, setName] = useState(source.name),
    [url, setUrl] = useState(source.kind === "url" ? source.location : ""),
    [file, setFile] = useState<{ name: string; content: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  // Null until read (and if reading fails, the section stays hidden).
  const [languages, setLanguages] = useState<SourceLanguages | null>(null),
    [savedLanguages, setSavedLanguages] = useState<SourceLanguages | null>(
      null,
    ),
    [groups, setGroups] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);

  // Leaving the page stops a download or file read still running.
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    let active = true;
    Promise.all([
      repo.getSourceLanguages(source.id),
      repo.listSourceGroups(source.id),
    ])
      .then(([stored, names]) => {
        if (!active) return;
        setLanguages(stored);
        setSavedLanguages(stored);
        setGroups(names);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [repo, source.id]);

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    close();
  };

  const chooseFile = async () => {
    if (busy) return;
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
      if (result.canceled) return;
      const asset = result.assets[0];
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      const content = await readPickedFile(asset.uri, abort.signal);
      if (!abort.signal.aborted) {
        setFile({ name: asset.name, content });
        setError("");
      }
    } catch {
      setError(`文件无法打开或超过 ${MAX_MIB} MB`);
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy) return;
    const newName = name.trim();
    if (!newName) {
      setError("请填写名称");
      return;
    }
    const newUrl = url.trim();
    const relink = source.kind === "url" && newUrl !== source.location;
    if (relink && !newUrl) {
      setError("请填写链接");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      if (relink || file) {
        let text = file?.content ?? "",
          baseUrl: string | undefined;
        // Taken before downloading, so a newer update wins over this one.
        const token = await repo.beginRefresh(source.id);
        if (relink) {
          if (!(await deps.guardRemote()) || abort.signal.aborted) return;
          if (!(await deps.checkNetwork()) || abort.signal.aborted) return;
          const downloaded = await downloadPlaylist(
            newUrl,
            abort.signal,
            deps.remoteRef.current,
          );
          text = downloaded.text;
          baseUrl = downloaded.url;
        }
        const parsed = await parseM3U(text, { baseUrl, signal: abort.signal });
        if (abort.signal.aborted) return;
        await repo.refreshSource(source.id, token.revision, parsed, {
          generation: token.generation,
          location: relink ? newUrl : file?.name,
          content: file?.content,
        });
        try {
          await deps.reconcilePlayingSources();
        } catch {
          /* The list is saved; the player catches up when reopened. */
        }
      }
      if (newName !== source.name) {
        try {
          await repo.renameSource(source.id, newName);
        } catch {
          if (relink || file) changed();
          if (deps.mounted.current) setError("名称未保存，请重试");
          return;
        }
      }
      if (
        languages &&
        JSON.stringify(languages) !== JSON.stringify(savedLanguages)
      ) {
        try {
          await repo.setSourceLanguages(source.id, languages);
          setSavedLanguages(languages);
        } catch {
          if (relink || file || newName !== source.name) changed();
          if (deps.mounted.current) setError("语言未保存，请重试");
          return;
        }
      }
      changed();
      if (!abort.signal.aborted) close();
    } catch (failure) {
      if (abort.signal.aborted || !deps.mounted.current) return;
      setError(
        failure instanceof ImportIOError || failure instanceof M3UParseError
          ? failure.message
          : relink || file
            ? "节目单未能更新，原频道不变"
            : "保存未完成，请重试",
      );
    } finally {
      if (controller.current === abort) controller.current = null;
      if (deps.mounted.current) setBusy(false);
    }
  };

  return {
    name,
    setName: (text: string) => {
      setName(text);
      setError("");
    },
    url,
    setUrl: (text: string) => {
      setUrl(text);
      setError("");
    },
    fileName: file?.name ?? (source.kind === "file" ? source.location : ""),
    languages,
    groups,
    setLanguages: (next: SourceLanguages) => {
      setLanguages(next);
      setError("");
    },
    chooseFile: () => void chooseFile(),
    busy,
    error,
    dismissError: () => setError(""),
    save: () => void save(),
    cancel,
  };
}

export type SourceEdit = ReturnType<typeof useSourceEdit>;
