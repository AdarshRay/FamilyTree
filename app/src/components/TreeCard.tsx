import { useState } from "react";
import { ROLE_LABEL, type TreeSummary } from "../data/mockAccount";

interface Props {
  tree: TreeSummary;
  onOpen: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onShare?: (id: string) => void;
  onSettings?: (id: string) => void;
}

export function TreeCard({ tree, onOpen, onRename, onShare, onSettings }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tree.name);
  const canRename = tree.role === "owner" && Boolean(onRename);
  const canShare = tree.role === "owner" && Boolean(onShare);
  const canConfigure = tree.role === "owner" && Boolean(onSettings);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(tree.name);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== tree.name) onRename?.(tree.id, trimmed);
  };

  return (
    <article
      className="tree-card"
    >
      <span className="modal-corner tl" />
      <span className="modal-corner tr" />
      <span className="modal-corner bl" />
      <span className="modal-corner br" />
      <div className={"tc-role " + tree.role}>{ROLE_LABEL[tree.role]}</div>
      <div className="tc-cover">
        <svg className="tc-preview" viewBox={tree.preview.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <g className="tc-preview-edges">
            {tree.preview.edges.map((edge, index) => (
              <path key={index} d={edge} />
            ))}
          </g>
          <g className="tc-preview-nodes">
            {tree.preview.nodes.map((node) => (
              <circle
                key={node.name}
                className={(node.gender === "f" ? "female" : "male") + (node.highlight ? " highlight" : "")}
                cx={node.x}
                cy={node.y}
                r={node.highlight ? 30 : 18}
              />
            ))}
          </g>
        </svg>
        <div className="tc-preview-glow" />
        <div className="tc-preview-count">
          {tree.generationCount} gen · {tree.memberCount} people
        </div>
      </div>
      <div className="tc-body">
        {editing ? (
          <input
            className="tc-name-input"
            value={draft}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className="tc-name-row">
            <div className="tc-name">{tree.name}</div>
            {canRename && (
              <button
                type="button"
                className="tc-rename-btn"
                onClick={startEdit}
                aria-label={`Rename ${tree.name}`}
              >
                ✎
              </button>
            )}
          </div>
        )}
        <div className="tc-subtitle">{tree.subtitle}</div>
        <div className="tc-stats">
          <span>
            {tree.memberCount} member{tree.memberCount === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>
            {tree.generationCount} generation{tree.generationCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="tc-updated">{tree.updatedLabel}</div>
        <div className="tc-actions">
          <button
            type="button"
            className="tc-open-btn"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(tree.id);
            }}
          >
            Open
          </button>
          {canShare && (
            <button
              type="button"
              className="tc-share-btn"
              onClick={(event) => {
                event.stopPropagation();
                onShare?.(tree.id);
              }}
            >
              Share
            </button>
          )}
          {canConfigure && (
            <button
              type="button"
              className="tc-settings-btn"
              onClick={(event) => {
                event.stopPropagation();
                onSettings?.(tree.id);
              }}
              aria-label={`Settings for ${tree.name}`}
              title="Tree settings"
            >
              ⚙
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function NewTreeCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="tree-card tree-card-new" onClick={onClick}>
      <span className="modal-corner tl" />
      <span className="modal-corner tr" />
      <span className="modal-corner bl" />
      <span className="modal-corner br" />
      <span className="tc-new-glyph">＋</span>
      <span className="tc-new-label">New Tree</span>
      <span className="tc-new-sub">Start a separate family line</span>
    </button>
  );
}
