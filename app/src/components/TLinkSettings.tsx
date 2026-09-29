import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  cancelTLinkRequest,
  claimTreePerson,
  getMyTLinkId,
  disconnectTLinkConnection,
  listTLinkBranchSnapshots,
  listTLinkConnectionEvents,
  listTLinkRequests,
  listTLinkConnections,
  listTreePeople,
  loadFamilyTree,
  saveFamilyTreeSnapshot,
  respondTLinkRequest,
  setTLinkConnectionActive,
  sendTLinkRequest,
  type FamilyTreeSummary,
  type TLinkRequest,
  type TLinkConnection,
  type TLinkBranchSnapshot,
  type TLinkConnectionEvent,
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
  const [branches, setBranches] = useState<TLinkBranchSnapshot[]>([]);
  const [events, setEvents] = useState<TLinkConnectionEvent[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [treeId, setTreeId] = useState(editableTrees[0]?.id ?? "");
  const [people, setPeople] = useState<TreePersonIdentity[]>([]);
  const [personId, setPersonId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [scope, setScope] = useState<TLinkScope>("identity");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refreshConnections = async () => {
    const [nextRequests, nextConnections, nextBranches, nextEvents] = await Promise.all([
      listTLinkRequests(), listTLinkConnections(), listTLinkBranchSnapshots(), listTLinkConnectionEvents(),
    ]);
    setRequests(nextRequests);
    setConnections(nextConnections);
    setBranches(nextBranches);
    setEvents(nextEvents);
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getMyTLinkId(), listTLinkRequests(), listTLinkConnections(), listTLinkBranchSnapshots(), listTLinkConnectionEvents()])
      .then(([id, nextRequests, nextConnections, nextBranches, nextEvents]) => {
        if (!cancelled) {
          setTlinkId(id);
          setRequests(nextRequests);
          setConnections(nextConnections);
          setBranches(nextBranches);
          setEvents(nextEvents);
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load TLink settings."));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!tlinkId) return setQrDataUrl("");
    void QRCode.toDataURL(tlinkId, { width: 220, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(""); });
    return () => { cancelled = true; };
  }, [tlinkId]);

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

  const applyRemoteProfile = async (remote: TLinkBranchSnapshot, local: TLinkBranchSnapshot) => {
    const localTreeId = local.sourceTreeId;
    const tree = await loadFamilyTree(localTreeId);
    if (!tree || tree.role === "viewer") throw new Error("You need edit access to apply shared details.");
    const currentName = local.branch.person.name;
    const person = remote.branch.person;
    await saveFamilyTreeSnapshot(localTreeId, {
      ...tree.snapshot,
      overrides: {
        ...tree.snapshot.overrides,
        [currentName]: {
          ...tree.snapshot.overrides[currentName],
          name: person.name,
          gender: person.gender,
          dob: person.dob,
          birthplace: person.birthplace,
          occupation: person.occupation,
          notes: person.notes,
          photoFile: person.photoFile,
          photoData: person.photoData,
          photoStoragePath: person.photoStoragePath,
        },
      },
      updatedAt: new Date().toISOString(),
    }, tree.updatedAt);
  };

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
      {qrDataUrl && (
        <details className="tlink-qr">
          <summary>Show QR code</summary>
          <div>
            <img src={qrDataUrl} alt="QR code containing your TLink ID" />
            <span>Scan to copy this TLink ID. The code is generated privately on this device.</span>
          </div>
        </details>
      )}

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
            <div className="tlink-connection-card" key={connection.id}>
              <div className="tlink-request">
               <div>
                <strong>{connection.personName}</strong>
                <span>
                  {connection.treeAName}{connection.treeBName ? ` ↔ ${connection.treeBName}` : ""}
                  {` · ${SCOPE_LABEL[connection.scope]}`}
                  {connection.disconnectedAt ? " · Permanently disconnected" : ""}
                </span>
               </div>
               <div className="tlink-request-actions">
                {!connection.disconnectedAt && (
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
                )}
                {!connection.disconnectedAt && (
                  <button className="danger" disabled={busy} onClick={() => setDisconnectingId(connection.id)}>Disconnect</button>
                )}
               </div>
              </div>
              {disconnectingId === connection.id && (
                <div className="tlink-disconnect-choice">
                  <span>Keep the last shared branch as a private copy, or remove it completely?</span>
                  <div className="tlink-request-actions">
                    <button disabled={busy} onClick={() => void run(
                      () => disconnectTLinkConnection(connection.id, true),
                      "Connection removed. The last shared copy was kept.",
                    ).then(() => setDisconnectingId(null))}>Keep copy</button>
                    <button className="danger" disabled={busy} onClick={() => void run(
                      () => disconnectTLinkConnection(connection.id, false),
                      "Connection and shared copy removed.",
                    ).then(() => setDisconnectingId(null))}>Remove completely</button>
                    <button disabled={busy} onClick={() => setDisconnectingId(null)}>Cancel</button>
                  </div>
                </div>
              )}
              {connection.scope !== "identity" && (() => {
                const connectionBranches = branches.filter((branch) => branch.connectionId === connection.id);
                const localBranch = connectionBranches.find((branch) => branch.sourceTreeId === treeId)
                  ?? connectionBranches.find((branch) => trees.some((tree) => tree.id === branch.sourceTreeId));
                const remoteBranch = connectionBranches.find((branch) => branch.sourceTreeId !== localBranch?.sourceTreeId);
                const fields = ["name", "dob", "birthplace", "occupation"] as const;
                const conflicts = localBranch && remoteBranch
                  ? fields.filter((field) => (localBranch.branch.person[field] ?? "") !== (remoteBranch.branch.person[field] ?? ""))
                  : [];
                return (
                  <details className="tlink-shared-branch">
                    <summary>Shared branch {remoteBranch ? `· ${remoteBranch.branch.children.length} direct descendant(s)` : "· waiting for their next update"}</summary>
                    {remoteBranch && (
                      <div className="tlink-branch-content">
                        <strong>{remoteBranch.branch.person.name}</strong>
                        <span>Revision {remoteBranch.revision} · updated {new Date(remoteBranch.updatedAt).toLocaleString()}</span>
                        <span>{remoteBranch.branch.children.map((child) => child.person.name).join(", ") || "No descendants in this shared branch yet."}</span>
                        {conflicts.length > 0 && localBranch && (
                          <div className="tlink-conflicts">
                            <b>Review {conflicts.length} profile difference{conflicts.length === 1 ? "" : "s"}</b>
                            {conflicts.map((field) => (
                              <span key={field}><em>{field}</em>: yours “{localBranch.branch.person[field] || "—"}” · theirs “{remoteBranch.branch.person[field] || "—"}”</span>
                            ))}
                            <button disabled={busy} onClick={() => void run(
                              () => applyRemoteProfile(remoteBranch, localBranch),
                              "Their profile details were applied to your tree.",
                            )}>Use their profile details</button>
                          </div>
                        )}
                      </div>
                    )}
                  </details>
                );
              })()}
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

      {events.length > 0 && (
        <details className="tlink-history">
          <summary>Detailed connection activity ({events.length})</summary>
          {events.map((event) => {
            const connection = connections.find((item) => item.id === event.connectionId);
            return (
              <div className="tlink-history-row" key={event.id}>
                <span>{connection?.personName ?? "Connected person"} · {event.action.replaceAll("_", " ")}</span>
                <time>{new Date(event.createdAt).toLocaleString()}</time>
              </div>
            );
          })}
        </details>
      )}

      {message && <div className="tlink-message">{message}</div>}
      {error && <div className="dash-error">{error}</div>}
    </div>
  );
}
