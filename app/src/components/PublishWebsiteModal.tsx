import { useEffect, useState } from "react";
import { GithubIcon } from "./icons";
import type {
  GitHubConnection,
  GitHubRepoOption,
  PublishRequestInput,
  PublishResult,
  PublishVisibility,
  TreePublishStatus,
} from "../lib/github";

export interface PublishableTree {
  id: string;
  name: string;
  status: TreePublishStatus;
}

interface Props {
  open: boolean;
  onClose: () => void;
  trees: PublishableTree[];
  /** Pre-selects a tree and skips the picker step — used when opened from Tree Settings. */
  initialTreeId?: string | null;
  githubConnection: GitHubConnection | null;
  onConnectGithub: () => Promise<GitHubConnection | null>;
  onLoadRepos: (username: string) => Promise<GitHubRepoOption[]>;
  onPublish: (input: PublishRequestInput) => Promise<PublishResult>;
}

type Step = "choose-tree" | "connect" | "repo" | "publishing" | "success" | "error";

const PUBLISH_STAGES = ["Preparing site files", "Creating repository", "Uploading content", "Enabling GitHub Pages", "Verifying live URL"];

function slugSuggestion(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "family-tree"
  );
}

export function PublishWebsiteModal({
  open,
  onClose,
  trees,
  initialTreeId = null,
  githubConnection,
  onConnectGithub,
  onLoadRepos,
  onPublish,
}: Props) {
  const [step, setStep] = useState<Step>("choose-tree");
  const [history, setHistory] = useState<Step[]>([]);
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  const [repoMode, setRepoMode] = useState<"new" | "existing">("new");
  const [repoName, setRepoName] = useState("");
  const [existingRepoId, setExistingRepoId] = useState("");
  const [visibility, setVisibility] = useState<PublishVisibility>("public");
  const [repos, setRepos] = useState<GitHubRepoOption[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState("");

  const [publishProgressIndex, setPublishProgressIndex] = useState(0);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const selectedTree = trees.find((tree) => tree.id === selectedTreeId) ?? null;

  useEffect(() => {
    if (!open) return;
    setHistory([]);
    setConnectError("");
    setErrorMessage("");
    setResult(null);
    setPublishProgressIndex(0);
    setRepos(null);
    setReposError("");
    setCopied(false);

    if (initialTreeId) {
      setSelectedTreeId(initialTreeId);
      const tree = trees.find((t) => t.id === initialTreeId) ?? null;
      setRepoMode("new");
      setRepoName(tree ? slugSuggestion(tree.name) : "");
      setExistingRepoId("");
      setVisibility("public");
      setStep(githubConnection ? "repo" : "connect");
    } else {
      setSelectedTreeId(null);
      setStep("choose-tree");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (step !== "repo" || repoMode !== "existing" || repos !== null || !githubConnection) return;
    setReposLoading(true);
    setReposError("");
    onLoadRepos(githubConnection.username)
      .then(setRepos)
      .catch((err) => setReposError(err instanceof Error ? err.message : "Could not load repositories."))
      .finally(() => setReposLoading(false));
  }, [step, repoMode, repos, githubConnection, onLoadRepos]);

  useEffect(() => {
    if (step !== "publishing") return;
    setPublishProgressIndex(0);
    const id = setInterval(() => {
      setPublishProgressIndex((i) => (i < PUBLISH_STAGES.length - 1 ? i + 1 : i));
    }, 850);
    return () => clearInterval(id);
  }, [step]);

  if (!open) return null;

  const goTo = (next: Step) => {
    setHistory((h) => [...h, step]);
    setStep(next);
  };

  const goBack = () => {
    setHistory((h) => {
      const copy = [...h];
      const prev = copy.pop();
      if (prev) setStep(prev);
      return copy;
    });
  };

  const chooseTree = (tree: PublishableTree) => {
    setSelectedTreeId(tree.id);
    setRepoMode("new");
    setRepoName(slugSuggestion(tree.name));
    setExistingRepoId("");
    setVisibility("public");
    goTo(githubConnection ? "repo" : "connect");
  };

  const connect = () => {
    setConnecting(true);
    setConnectError("");
    onConnectGithub()
      .then((connection) => {
        if (connection) goTo("repo");
      })
      .catch((err) => setConnectError(err instanceof Error ? err.message : "Could not connect to GitHub."))
      .finally(() => setConnecting(false));
  };

  const submitPublish = () => {
    if (!selectedTree) return;
    setErrorMessage("");
    setStep("publishing");
    const input: PublishRequestInput = {
      treeId: selectedTree.id,
      repoMode,
      repoName: repoMode === "new" ? repoName.trim() : undefined,
      existingRepoId: repoMode === "existing" ? existingRepoId : undefined,
      visibility,
    };
    onPublish(input)
      .then((res) => {
        setResult(res);
        setStep("success");
      })
      .catch((err) => {
        setErrorMessage(err instanceof Error ? err.message : "Publishing failed. Please try again.");
        setStep("error");
      });
  };

  const canBack = history.length > 0 && (step === "choose-tree" || step === "connect" || step === "repo");
  const repoValid = repoMode === "new" ? repoName.trim().length > 0 : Boolean(existingRepoId);

  return (
    <div className="ct-overlay" role="dialog" aria-modal="true" aria-labelledby="publish-title">
      <button className="ct-scrim" aria-label="Close publish dialog" onClick={onClose} />
      <div className="ct-panel publish-panel">
        <span className="modal-corner tl" />
        <span className="modal-corner tr" />
        <span className="modal-corner bl" />
        <span className="modal-corner br" />

        <div className="ct-head">
          <div>
            <div className="backup-kicker">Publish Website</div>
            <h2 id="publish-title">{selectedTree ? selectedTree.name : "Publish a Family Tree"}</h2>
          </div>
          <button className="backup-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        {step !== "publishing" && step !== "success" && (
          <ol className="publish-steps" aria-hidden="true">
            <li className={stepClass(step, "choose-tree", Boolean(initialTreeId))}>Tree</li>
            <li className={stepClass(step, "connect", Boolean(githubConnection))}>GitHub</li>
            <li className={stepClass(step, "repo", false)}>Repository</li>
          </ol>
        )}

        {step === "choose-tree" && (
          <div className="publish-body">
            <p className="publish-lead">Choose which family tree to publish as a website.</p>
            <div className="share-rows publish-tree-list">
              {trees.length === 0 ? (
                <div className="share-empty">No trees yet — create one from the dashboard first.</div>
              ) : (
                trees.map((tree) => (
                  <button type="button" className="publish-tree-row" key={tree.id} onClick={() => chooseTree(tree)}>
                    <span className="publish-tree-name">{tree.name}</span>
                    <span className={`publish-status-tag ${tree.status.state}`}>
                      {tree.status.state === "published" ? "Published" : "Not published"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {step === "connect" && (
          <div className="publish-body">
            <div className="gh-connect-card">
              <span className="gh-connect-icon">
                <GithubIcon />
              </span>
              <h3>Connect GitHub</h3>
              <p>
                Publishing pushes a read-only build of {selectedTree ? `"${selectedTree.name}"` : "your tree"} to a
                repository in your own GitHub account and serves it with GitHub Pages.
              </p>
              {connectError && <div className="dash-error publish-error">{connectError}</div>}
              <button className="gh-connect-btn" onClick={connect} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect GitHub"}
              </button>
            </div>
          </div>
        )}

        {step === "repo" && selectedTree && (
          <div className="publish-body">
            {githubConnection && (
              <div className="gh-connected-chip">
                <GithubIcon />
                Connected as <b>{githubConnection.username}</b>
              </div>
            )}

            <div className="share-role-toggle publish-repo-mode" role="group" aria-label="Repository source">
              <button
                type="button"
                className={`share-role-btn editor${repoMode === "new" ? " active" : ""}`}
                aria-pressed={repoMode === "new"}
                onClick={() => setRepoMode("new")}
              >
                Create new repo
              </button>
              <button
                type="button"
                className={`share-role-btn viewer${repoMode === "existing" ? " active" : ""}`}
                aria-pressed={repoMode === "existing"}
                onClick={() => setRepoMode("existing")}
              >
                Use existing repo
              </button>
            </div>

            {repoMode === "new" ? (
              <label className="field publish-field">
                <span>Repository name</span>
                <input value={repoName} onChange={(e) => setRepoName(slugSuggestion(e.target.value))} placeholder="family-tree" />
                {githubConnection && repoName && (
                  <em className="publish-url-preview">
                    → https://{githubConnection.username}.github.io/{repoName}/
                  </em>
                )}
              </label>
            ) : (
              <div className="publish-field">
                <span className="field-label">Choose a repository</span>
                {reposLoading ? (
                  <div className="share-empty">Loading your repositories…</div>
                ) : reposError ? (
                  <div className="dash-error publish-error">{reposError}</div>
                ) : (
                  <div className="share-rows publish-repo-list">
                    {(repos ?? []).map((repo) => (
                      <button
                        type="button"
                        key={repo.id}
                        className={`publish-repo-row${existingRepoId === repo.fullName ? " active" : ""}`}
                        onClick={() => setExistingRepoId(repo.fullName)}
                      >
                        <span>{repo.fullName}</span>
                        {repo.private && <em>Private</em>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="publish-field">
              <span className="field-label">Visibility</span>
              <div className="share-role-toggle">
                <button
                  type="button"
                  className={`share-role-btn viewer${visibility === "public" ? " active" : ""}`}
                  aria-pressed={visibility === "public"}
                  onClick={() => setVisibility("public")}
                >
                  Public
                </button>
                <button
                  type="button"
                  className={`share-role-btn editor${visibility === "private" ? " active" : ""}`}
                  aria-pressed={visibility === "private"}
                  onClick={() => setVisibility("private")}
                >
                  Private
                </button>
              </div>
              {visibility === "private" && <p className="publish-hint">Private repos need GitHub Pro/Team for Pages hosting.</p>}
            </div>
          </div>
        )}

        {step === "publishing" && (
          <div className="publish-body">
            <ul className="publish-progress">
              {PUBLISH_STAGES.map((label, index) => (
                <li
                  key={label}
                  className={index < publishProgressIndex ? "done" : index === publishProgressIndex ? "active" : ""}
                >
                  <span className="publish-progress-dot" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === "success" && result && (
          <div className="publish-body publish-success">
            <div className="publish-success-badge">✓</div>
            <h3>Your family tree is live</h3>
            <p>Published to {result.repoFullName}</p>
            <div className="publish-url-row">
              <span>{result.url}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(result.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="btnrow publish-success-actions">
              <a className="btn primary" href={result.url} target="_blank" rel="noreferrer">
                View Site
              </a>
              <button className="btn ghost" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="publish-body publish-error-state">
            <div className="publish-error-badge">!</div>
            <h3>Publishing failed</h3>
            <p>{errorMessage}</p>
          </div>
        )}

        {(step === "choose-tree" || step === "connect" || step === "repo" || step === "error") && (
          <div className="btnrow publish-actions">
            {canBack && (
              <button className="btn ghost" onClick={goBack}>
                Back
              </button>
            )}
            {step === "repo" && (
              <button className="btn primary" onClick={submitPublish} disabled={!repoValid}>
                Publish
              </button>
            )}
            {step === "error" && (
              <>
                <button className="btn ghost" onClick={() => setStep("repo")}>
                  Back
                </button>
                <button className="btn primary" onClick={submitPublish}>
                  Retry
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function stepClass(current: Step, target: Step, skipped: boolean): string {
  const order: Step[] = ["choose-tree", "connect", "repo"];
  const currentIndex = order.indexOf(current === "publishing" || current === "success" || current === "error" ? "repo" : current);
  const targetIndex = order.indexOf(target);
  if (skipped && target !== "repo" && currentIndex >= 0) return "done skipped";
  if (targetIndex < currentIndex) return "done";
  if (targetIndex === currentIndex) return "active";
  return "";
}
