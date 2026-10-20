import React, { useEffect, useState } from "react";
import type { Repository } from "../../data/repository";
import type { Source } from "../../domain/types";
import { SourceFormModal } from "../source/SourceFormModal";
import { EditSourceModal } from "../source/EditSourceModal";
import type { SourceEditDeps } from "../source/useSourceEdit";
import { SourceManagerModal } from "../source/SourceManagerModal";
import type { SourceImport } from "./useSourceImport";
import type { useSourceTasks } from "./useSourceTasks";

/**
 * Source management and the dialogs it opens: the edit page (name and
 * link in one save), and the add form. Both open on top of management, which stays open underneath, so
 * leaving them simply reveals it again. Closing one Android modal while
 * opening another in the same moment could leave the new one undrawn yet
 * still taking touches.
 */
export function SourceDialogs({
  repo,
  sources,
  managing,
  setManaging,
  renaming,
  setRenaming,
  error,
  setError,
  importer,
  sourceTasks,
  onRemoveSource,
  onSetSourceEnabled,
  changed,
  editDeps,
}: {
  repo: Repository;
  sources: Source[];
  managing: boolean;
  setManaging: (open: boolean) => void;
  renaming: Source | null;
  setRenaming: (source: Source | null) => void;
  error: string;
  setError: (message: string) => void;
  importer: SourceImport;
  sourceTasks: ReturnType<typeof useSourceTasks>;
  onRemoveSource: (source: Source) => void;
  onSetSourceEnabled: (source: Source, enabled: boolean) => Promise<void>;
  changed: () => void;
  /** Network consent and playback hooks the edit page's save goes through. */
  editDeps: SourceEditDeps;
}) {
  const [sourceSaving, setSourceSaving] = useState<string | null>(null);

  // The edit page belongs to management: it goes when management does,
  // e.g. after an update saved from it shows the channel list.
  useEffect(() => {
    if (!managing) setRenaming(null);
  }, [managing, setRenaming]);
  return (
    <>
      <SourceManagerModal
        visible={managing}
        // A dialog open on top shows the shared error itself.
        error={renaming || importer.form ? undefined : error}
        onDismissError={() => setError("")}
        sources={sources}
        check={sourceTasks.check}
        summaries={sourceTasks.checkSummaries}
        onClose={() => setManaging(false)}
        onAdd={(kind) => importer.startForm(kind, true)}
        onRename={(source) => {
          setError("");
          setRenaming(source);
        }}
        onRemove={onRemoveSource}
        sourceSaving={sourceSaving}
        onEnabledChange={(source, enabled) => {
          if (sourceSaving) return;
          setSourceSaving(source.id);
          void onSetSourceEnabled(source, enabled).finally(() =>
            setSourceSaving(null),
          );
        }}
        onCheck={(source, force) => void sourceTasks.runCheck(source, force)}
        onStopCheck={sourceTasks.stopCheck}
      />
      <EditSourceModal
        source={renaming}
        repo={repo}
        close={() => setRenaming(null)}
        changed={changed}
        deps={editDeps}
      />
      <SourceFormModal
        form={importer.form}
        busy={importer.busy}
        error={importer.formError || error}
        onUpdate={importer.updateForm}
        onFillLanguages={importer.setFillLanguages}
        onChooseFile={() => void importer.chooseFile()}
        onPreview={() => void importer.preview()}
        onSave={() => void importer.save()}
        onBack={() => void importer.backForm()}
      />
    </>
  );
}
