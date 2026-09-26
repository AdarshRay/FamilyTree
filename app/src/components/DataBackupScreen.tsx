import { useRef, useState } from "react";
import type { FamilyEditsSnapshot } from "../lib/permanent";
import { PersonPicker } from "./PersonPicker";

interface PersonOption {
  name: string;
  label: string;
}

interface Props {
  open: boolean;
  saveStatus: string;
  memberCount: number;
  generationCount: number;
  profileEditCount: number;
  structureEditCount: number;
  canUndo: boolean;
  recentlyRemoved: Array<{ name: string; label: string }>;
  people: PersonOption[];
  onClose: () => void;
  onExport: () => void;
  onExportExcel: () => void;
  onBackupToMac?: () => void;
  onRestoreFromMac?: () => void;
  onPublishToGitHub?: () => void;
  onImport: (snapshot: Partial<FamilyEditsSnapshot>) => void;
  onSaveAll: () => void;
  onUndo: () => void;
  onRestoreRemoved: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
}

export function DataBackupScreen({
  open,
  saveStatus,
  memberCount,
  generationCount,
  profileEditCount,
  structureEditCount,
  canUndo,
  recentlyRemoved,
  people,
  onClose,
  onExport,
  onExportExcel,
  onBackupToMac,
  onRestoreFromMac,
  onPublishToGitHub,
  onImport,
  onSaveAll,
  onUndo,
  onRestoreRemoved,
  onRename,
}: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");

  if (!open) return null;

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<FamilyEditsSnapshot>;
      const ok = window.confirm("Restore this family edit backup? This will replace current saved edits.");
      if (ok) onImport(parsed);
    } catch {
      alert("Could not read that JSON backup.");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  return (
    <div className="backup-overlay" role="dialog" aria-modal="true" aria-labelledby="backup-title">
      <button className="backup-scrim" aria-label="Close backup screen" onClick={onClose} />
      <div className="backup-panel">
        <span className="modal-corner tl" />
        <span className="modal-corner tr" />
        <span className="modal-corner bl" />
        <span className="modal-corner br" />
        <div className="backup-head">
          <div>
            <div className="backup-kicker">Family Data</div>
            <h2 id="backup-title">Backup & Restore</h2>
          </div>
          <button className="backup-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className="backup-status">{saveStatus}</div>

        <div className="backup-grid">
          <div className="backup-stat">
            <span>Members</span>
            <b>{memberCount}</b>
          </div>
          <div className="backup-stat">
            <span>Generations</span>
            <b>{generationCount}</b>
          </div>
          <div className="backup-stat">
            <span>Profiles</span>
            <b>{profileEditCount}</b>
          </div>
          <div className="backup-stat">
            <span>Tree Edits</span>
            <b>{structureEditCount}</b>
          </div>
        </div>

        <div className="backup-actions">
          <button className="backup-action primary" onClick={onSaveAll}>
            <span>Save Now</span>
          </button>
          <button className="backup-action" onClick={onUndo} disabled={!canUndo}>
            <span>Undo Last Change</span>
          </button>
          {onBackupToMac ? (
            <button className="backup-action" onClick={onBackupToMac}>
              <span>Backup to Mac</span>
            </button>
          ) : (
            <button className="backup-action" onClick={onExport}>
              <span>Download JSON</span>
            </button>
          )}
          <button className="backup-action" onClick={onExportExcel}>
            <span>Download Excel</span>
          </button>
          {onRestoreFromMac ? (
            <button className="backup-action" onClick={onRestoreFromMac}>
              <span>Restore from Mac</span>
            </button>
          ) : (
            <button className="backup-action" onClick={() => importRef.current?.click()}>
              <span>Restore Backup</span>
            </button>
          )}
          {onPublishToGitHub && (
            <button className="backup-action primary" onClick={onPublishToGitHub}>
              <span>Publish to GitHub</span>
            </button>
          )}
        </div>

        <div className="removed-panel">
          <div className="removed-head">
            <span>Recently Removed</span>
            <b>{recentlyRemoved.length}</b>
          </div>
          {recentlyRemoved.length ? (
            <div className="removed-list">
              {recentlyRemoved.map((item) => (
                <div className="removed-item" key={item.name}>
                  <span>{item.label}</span>
                  <button onClick={() => onRestoreRemoved(item.name)}>Restore</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="removed-empty">No removed branches</div>
          )}
        </div>

        <div className="rename-panel">
          <div className="removed-head">
            <span>True Rename</span>
          </div>
          <div className="rename-row">
            <PersonPicker value={renameFrom} onChange={setRenameFrom} people={people} placeholder="Select person" />
            <input
              value={renameTo}
              onChange={(event) => setRenameTo(event.target.value)}
              placeholder="New internal name"
            />
            <button
              onClick={() => {
                onRename(renameFrom, renameTo);
                setRenameFrom("");
                setRenameTo("");
              }}
              disabled={!renameFrom || !renameTo.trim()}
            >
              Rename
            </button>
          </div>
        </div>

        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => onImportFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
