import { useEffect, useMemo, useState } from "react";
import {
  cancelTLinkRequest,
  claimTreePerson,
  getMyTLinkId,
  listTLinkRequests,
  listTLinkConnections,
  listTreePeople,
  loadFamilyTree,
  respondTLinkRequest,
  setTLinkConnectionActive,
  sendTLinkRequest,
  type FamilyTreeSummary,
  type TLinkRequest,
  type TLinkConnection,
  type TLinkScope,
  type TreePersonIdentity,
} from "../lib/backend";

interface Props {
  trees: FamilyTreeSummary[];
}

const SCOPE_LABEL: Record<TLinkScope, string> = {
  identity: "Connect identity only",
  branch: "Share connected branch",
  collaboration: "Full tree collaboration",
};

export function TLinkSettings({ trees }: Props) {
  const editableTrees = useMemo(() => trees.filter((tree) => tree.role !== "viewer"), [trees]);
  const [tlinkId, setTlinkId] = useState("");
  const [requests, setRequests] = useState<TLinkRequest[]>([]);
  const [connections, setConnections] = useState<TLinkConnection[]>([]);
  const [treeId, setTreeId] = useState(editableTrees[0]?.id ?? "");
  const [people, setPeople] = useState<TreePersonIdentity[]>([]);
  const [personId, setPersonId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [scope, setScope] = useState<TLinkScope>("identity");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refreshConnections = async () => {
    const [nextRequests, nextConnections] = await Promise.all([listTLinkRequests(), listTLinkConnections()]);
    setRequests(nextRequests);
    setConnections(nextConnections);
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getMyTLinkId(), listTLinkRequests(), listTLinkConnections()])
      .then(([id, nextRequests, nextConnections]) => {
        if (!cancelled) {
          setTlinkId(id);
          setRequests(nextRequests);
          setConnections(nextConnections);
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load TLink settings."));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!treeId) {
      setPeople([]);
      setPersonId("");
      return;
    }
    let cancelled = false;
    setError("");
    void loadFamilyTree(treeId)
      .then((tree) => {
        if (cancelled || !tree) return;
        const choices = listTreePeople(tree.root, tree.snapshot);
        setPeople(choices);
        setPersonId((current) => choices.some((person) => person.id === current) ? current : choices[0]?.id ?? "");
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load tree profiles."));
    return () => { cancelled = true; };
  }, [treeId]);

  const run = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
      await refreshConnections();
      setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete that TLink action.");
    } finally {
      setBusy(false);
    }
  };

  const pendingIncoming = requests.filter((request) => request.direction === "incoming" && request.status === "pending");
  const history = requests.filter((request) => request.direction === "outgoing" || request.status !== "pending");
  const selectedTarget = treeId && personId ? { treeId, localPersonId: personId } : undefined;

  return (
    <div className="settings-card tlink-card">
      <div className="tlink-id-row">
        <div className="settings-row-text">
          <span className="settings-row-title">Your TLink ID</span>
          <span className="settings-row-sub">Share this only with relatives you want to connect with.</span>
        </div>
        <div className="tlink-code-wrap">
          <code>{tlinkId || "Generating…"}</code>
          <button
            type="button"
            className="settings-row-action"
            disabled={!tlinkId}
            onClick={() => void navigator.clipboard.writeText(tlinkId).then(() => setMessage("TLink ID copied."))}
          >
            Copy
          </button>
        </div>
      </div>

      {editableTrees.length > 0 && (
        <div className="tlink-workspace">
          <div className="tlink-grid">
            <label className="field">
              <span>Your tree</span>
              <select value={treeId} onChange={(event) => setTreeId(event.target.value)} disabled={busy}>
                {editableTrees.map((tree) => <option key={tree.id} value={tree.id}>{tree.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Profile in this tree</span>
              <select value={personId} onChange={(event) => setPersonId(event.target.value)} disabled={busy || !people.length}>
                {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="settings-row-action"
            disabled={busy || !selectedTarget}
            onClick={() => selectedTarget && void run(
              () => claimTreePerson(selectedTarget.treeId, selectedTarget.localPersonId),
              "This profile is now connected to your account.",
            )}
          >
            Mark this profile as me
          </button>
        </div>
      )}

      <div className="settings-separator" />
      <div className="tlink-connect-form">
        <div className="settings-row-text">
          <span className="settings-row-title">Connect a person</span>
          <span className="settings-row-sub">Select the relative’s profile above, then enter the TLink ID they gave you.</span>
        </div>
        <div className="tlink-grid tlink-send-grid">
          <label className="field">
            <span>Relative’s TLink ID</span>
            <input value={recipientId} onChange={(event) => setRecipientId(event.target.value.toUpperCase())} placeholder="TLINK-…" />
          </label>
          <label className="field">
            <span>Connection permission</span>
            <select value={scope} onChange={(event) => setScope(event.target.value as TLinkScope)}>
              {Object.entries(SCOPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !selectedTarget || !recipientId.trim()}
          onClick={() => selectedTarget && void run(
            () => sendTLinkRequest(selectedTarget.treeId, selectedTarget.localPersonId, recipientId, scope),
            "Connection request sent.",
          )}
        >
          Send connection request
        </button>
      </div>

      {pendingIncoming.length > 0 && (
        <div className="tlink-requests">
          <h3>Requests waiting for you</h3>
          {pendingIncoming.map((request) => (
            <div className="tlink-request" key={request.id}>
              <div>
                <strong>{request.sourcePersonName}</strong>
                <span>{request.sourceTreeName} · {SCOPE_LABEL[request.scope]}</span>
              </div>
              <div className="tlink-request-actions">
                <button disabled={busy} onClick={() => void run(
                  () => respondTLinkRequest(request.id, true, selectedTarget),
                  "Trees connected successfully.",
                )}>Approve</button>
                <button className="danger" disabled={busy} onClick={() => void run(
                  () => respondTLinkRequest(request.id, false),
                  "Request declined.",
                )}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {connections.length > 0 && (
        <div className="tlink-requests">
          <h3>Connected trees</h3>
          {connections.map((connection) => (
            <div className="tlink-request" key={connection.id}>
              <div>
                <strong>{connection.personName}</strong>
                <span>
                  {connection.treeAName}{connection.treeBName ? ` ↔ ${connection.treeBName}` : ""}
                  {` · ${SCOPE_LABEL[connection.scope]}`}
                </span>
              </div>
              <div className="tlink-request-actions">
                <button
                  className={connection.active ? "danger" : ""}
                  disabled={busy}
                  onClick={() => void run(
                    () => setTLinkConnectionActive(connection.id, !connection.active),
                    connection.active ? "Connection paused." : "Connection resumed.",
                  )}
                >
                  {connection.active ? "Pause" : "Resume"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <details className="tlink-history">
          <summary>Connection history ({history.length})</summary>
          {history.map((request) => (
            <div className="tlink-history-row" key={request.id}>
              <span>{request.sourcePersonName} · {request.sourceTreeName}</span>
              <span className="tlink-history-actions">
                <em>{request.direction} · {request.status}</em>
                {request.direction === "outgoing" && request.status === "pending" && (
                  <button disabled={busy} onClick={() => void run(
                    () => cancelTLinkRequest(request.id),
                    "Request cancelled.",
                  )}>Cancel</button>
                )}
              </span>
            </div>
          ))}
        </details>
      )}

      {message && <div className="tlink-message">{message}</div>}
      {error && <div className="dash-error">{error}</div>}
    </div>
  );
}
