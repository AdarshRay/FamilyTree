import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import App from "./App";
import { LoginScreen } from "./screens/LoginScreen";
import { Dashboard } from "./screens/Dashboard";
import { AccountSettings } from "./screens/AccountSettings";
import { AdminConsole } from "./screens/AdminConsole";
import { AccountMenu } from "./components/AccountMenu";
import { InstallAppChoice } from "./components/InstallAppChoice";
import { ShareTreeModal } from "./components/ShareTreeModal";
import { TreeSettingsModal } from "./components/TreeSettingsModal";
import { PublishWebsiteModal, type PublishableTree } from "./components/PublishWebsiteModal";
import type { NewTreeDetails } from "./components/CreateTreeModal";
import type { AccountUser, TreeSummary } from "./data/mockAccount";
import {
  createFamilyTree,
  createAccountWithPassword,
  deleteFamilyTree,
  deleteAccount,
  completeSocialProviderRedirect,
  getAuthSession,
  getAdminAccess,
  inviteFamilyTreeMember,
  listFamilyTreeSharing,
  listFamilyTrees,
  listTLinkRequests,
  listTLinkSharedBranchesForTree,
  loadFamilyTree,
  removeFamilyTreeInvitation,
  removeFamilyTreeMember,
  renameFamilyTree,
  saveFamilyTreeSnapshot,
  sendTLinkRequest,
  subscribeToTLinkBranchChanges,
  signInWithPassword,
  signInWithSocialProvider,
  signOut as signOutBackend,
  updateFamilyTreeInvitationRole,
  updateFamilyTreeMemberRole,
  updateUserProfile,
  type AppUser,
  type AdminRole,
  type AuthProvider,
  type FamilyTreeRecord,
  type FamilyTreeSummary,
  type TreeInviteInput,
  type TreeRole,
  type TreeSharing,
  type TLinkSharedBranchMount,
  TreeSyncConflictError,
} from "./lib/backend";
import { onDesktopAuthCallbackUrl } from "./lib/desktop";
import {
  clearGitHubOAuthReturnFromLocation,
  disconnectGitHub,
  getGitHubConnection,
  getTreePublishStatus,
  gitHubOAuthReturnMessage,
  gitHubOAuthReturnWasError,
  isGitHubBackendAvailable,
  isGitHubOAuthReturn,
  listGitHubRepositories,
  mockConnectGitHub,
  mockDisconnectGitHub,
  mockListGitHubRepos,
  mockPublishTree,
  publishTreeWebsite,
  startGitHubConnect,
  type GitHubConnection,
  type GitHubRepoOption,
  type PublishRequestInput,
  type TreePublishStatus,
} from "./lib/github";

const STARTUP_TIMEOUT_MS = 9000;

function accountUser(user: AppUser): AccountUser {
  return {
    name: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

function updatedLabel(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Updated recently";
  const diff = Date.now() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Updated just now";
  if (diff < hour) return `Updated ${Math.max(1, Math.floor(diff / minute))} min ago`;
  if (diff < day) return `Updated ${Math.max(1, Math.floor(diff / hour))} hr ago`;
  const days = Math.floor(diff / day);
  if (days === 1) return "Updated yesterday";
  if (days < 14) return `Updated ${days} days ago`;
  return `Updated ${new Date(value).toLocaleDateString()}`;
}

function treeCardSummary(tree: FamilyTreeSummary): TreeSummary {
  return {
    id: tree.id,
    name: tree.name,
    subtitle: tree.role === "owner" ? "Owned by you" : "Shared with you",
    role: tree.role,
    memberCount: tree.memberCount,
    generationCount: tree.generationCount,
    updatedLabel: updatedLabel(tree.updatedAt),
    preview: tree.preview,
  };
}

function isSocialProvider(provider: AuthProvider): provider is Exclude<AuthProvider, "password"> {
  return provider !== "password";
}

function withStartupTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`${label} took too long. Check your Supabase project URL and network connection.`));
    }, STARTUP_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timeout);
        reject(err);
      },
    );
  });
}

/** Session/dashboard flow controller — sits above the tree canvas (`App`). */
export default function AppRoot() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [trees, setTrees] = useState<FamilyTreeSummary[]>([]);
  const [activeTree, setActiveTree] = useState<FamilyTreeRecord | null>(null);
  const [sharingTreeId, setSharingTreeId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<TreeSharing | null>(null);
  const [sharingError, setSharingError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingTLinkCount, setPendingTLinkCount] = useState(0);
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  const [adminTreeMode, setAdminTreeMode] = useState(false);
  const [sharedBranches, setSharedBranches] = useState<TLinkSharedBranchMount[]>([]);

  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [settingsTreeId, setSettingsTreeId] = useState<string | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishInitialTreeId, setPublishInitialTreeId] = useState<string | null>(null);
  const [publishStatusByTreeId, setPublishStatusByTreeId] = useState<Record<string, TreePublishStatus>>({});

  const [githubConnection, setGithubConnection] = useState<GitHubConnection | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubError, setGithubError] = useState("");
  const activeTreeRef = useRef<FamilyTreeRecord | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const savesInFlightRef = useRef(0);

  useEffect(() => {
    activeTreeRef.current = activeTree;
  }, [activeTree]);

  useEffect(() => {
    if (!activeTree) return;
    return subscribeToTLinkBranchChanges(() => {
      void listTLinkSharedBranchesForTree(activeTree.id).then(setSharedBranches).catch(() => undefined);
    });
  }, [activeTree?.id]);

  const refreshActiveTreeFromCloud = useCallback(async (force = false) => {
    const current = activeTreeRef.current;
    if (!current || (!force && savesInFlightRef.current > 0)) return;
    const latest = await loadFamilyTree(current.id);
    const nextSharedBranches = await listTLinkSharedBranchesForTree(current.id);
    setSharedBranches(nextSharedBranches);
    if (!latest || latest.updatedAt === current.updatedAt) return;
    activeTreeRef.current = latest;
    setActiveTree(latest);
    setError("");
  }, []);

  const saveActiveTreeSnapshot = useCallback((treeId: string, snapshot: Parameters<typeof saveFamilyTreeSnapshot>[1]) => {
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      savesInFlightRef.current += 1;
      try {
        const current = activeTreeRef.current;
        const expectedUpdatedAt = current?.id === treeId ? current.updatedAt : undefined;
        const savedAt = await saveFamilyTreeSnapshot(treeId, snapshot, expectedUpdatedAt);
        setActiveTree((value) => {
          if (!value || value.id !== treeId) return value;
          const next = { ...value, snapshot, updatedAt: savedAt };
          activeTreeRef.current = next;
          return next;
        });
      } catch (err) {
        if (err instanceof TreeSyncConflictError) await refreshActiveTreeFromCloud(true);
        throw err;
      } finally {
        savesInFlightRef.current -= 1;
      }
    });
    saveQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [refreshActiveTreeFromCloud]);

  const refreshGitHubConnection = useCallback(async () => {
    if (!isGitHubBackendAvailable()) return null;
    const connection = await getGitHubConnection();
    setGithubConnection(connection);
    return connection;
  }, []);

  const dashboardTrees = useMemo(() => trees.map(treeCardSummary), [trees]);

  const refreshTrees = useCallback(async (nextUser: AppUser) => {
    const listedTrees = await listFamilyTrees(nextUser.id);
    setTrees(listedTrees);
  }, []);

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const operation = activeTreeRef.current
        ? refreshActiveTreeFromCloud()
        : refreshTrees(user);
      void operation.catch((err) => {
        setError(err instanceof Error ? err.message : "Could not refresh the latest cloud changes.");
      });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshActiveTreeFromCloud, refreshTrees, user]);

  useEffect(() => {
    let cancelled = false;
    void withStartupTimeout(getAuthSession(), "Restoring your session")
      .then(async (session) => {
        if (cancelled) return;
        setUser(session?.user ?? null);
        if (session?.user) {
          const [, access] = await Promise.all([
            withStartupTimeout(refreshTrees(session.user), "Loading your family trees"),
            getAdminAccess(),
          ]);
          if (!cancelled) setAdminRole(access);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not restore session.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshTrees]);

  useEffect(() => {
    if (!user) {
      setPendingTLinkCount(0);
      return;
    }
    const refresh = () => void listTLinkRequests()
      .then((requests) => setPendingTLinkCount(requests.filter((request) => request.direction === "incoming" && request.status === "pending").length))
      .catch(() => undefined);
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [user]);

  useEffect(() => {
    return onDesktopAuthCallbackUrl((callbackUrl) => {
      if (isGitHubOAuthReturn(callbackUrl)) {
        setGithubBusy(true);
        setGithubError("");
        const message = gitHubOAuthReturnMessage(callbackUrl);
        if (gitHubOAuthReturnWasError(callbackUrl)) {
          setGithubError(message ?? "Could not finish GitHub connection.");
          setGithubBusy(false);
          return;
        }
        void refreshGitHubConnection()
          .catch((err) => {
            setGithubError(message ?? (err instanceof Error ? err.message : "Could not finish GitHub connection."));
          })
          .finally(() => setGithubBusy(false));
        return;
      }

      setBusy(true);
      setError("");
      void completeSocialProviderRedirect(callbackUrl)
        .then(async (session) => {
          if (!session) throw new Error("Login did not return a session.");
          await completeAuthenticatedSession(session.user);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Could not finish Google login.");
        })
        .finally(() => setBusy(false));
    });
  }, [refreshGitHubConnection, refreshTrees]);

  useEffect(() => {
    if (!user || !isGitHubBackendAvailable()) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("github")) return;
    const message = url.searchParams.get("message");
    if (url.searchParams.get("github") === "error") {
      setGithubError(message ?? "Could not finish GitHub connection.");
      clearGitHubOAuthReturnFromLocation();
      return;
    }
    setGithubBusy(true);
    setGithubError("");
    void refreshGitHubConnection()
      .catch((err) => {
        setGithubError(message ?? (err instanceof Error ? err.message : "Could not finish GitHub connection."));
      })
      .finally(() => {
        clearGitHubOAuthReturnFromLocation();
        setGithubBusy(false);
      });
  }, [refreshGitHubConnection, user]);

  useEffect(() => {
    if (!user || !isGitHubBackendAvailable()) return;
    void refreshGitHubConnection().catch((err) => {
      setGithubError(err instanceof Error ? err.message : "Could not load GitHub connection.");
    });
  }, [refreshGitHubConnection, user]);

  useEffect(() => {
    if (!user || !isGitHubBackendAvailable()) return;
    const ownerTrees = trees.filter((tree) => tree.role === "owner");
    if (ownerTrees.length === 0) return;
    let cancelled = false;
    void Promise.all(
      ownerTrees.map(async (tree) => [tree.id, await getTreePublishStatus(tree.id)] as const),
    )
      .then((entries) => {
        if (cancelled) return;
        setPublishStatusByTreeId((current) => ({
          ...current,
          ...Object.fromEntries(entries),
        }));
      })
      .catch(() => {
        // Publish status is helpful, not required for opening the dashboard.
      });
    return () => {
      cancelled = true;
    };
  }, [trees, user]);

  const completeAuthenticatedSession = async (nextUser: AppUser) => {
    setUser(nextUser);
    const [, access] = await Promise.all([refreshTrees(nextUser), getAdminAccess()]);
    setAdminRole(access);
  };

  const signIn = async (identifier: string, password: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await signInWithPassword(identifier, password);
      if (!result.session) throw new Error("Login did not return a session.");
      await completeAuthenticatedSession(result.session.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await createAccountWithPassword(email, password, displayName);
      if (!result.session) throw new Error("Account created. Check your email to confirm before signing in.");
      await completeAuthenticatedSession(result.session.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const signInSocial = async (provider: AuthProvider) => {
    if (!isSocialProvider(provider)) return;
    setBusy(true);
    setError("");
    try {
      const result = await signInWithSocialProvider(provider);
      if (result.session) {
        setUser(result.session.user);
        const [, access] = await Promise.all([refreshTrees(result.session.user), getAdminAccess()]);
        setAdminRole(access);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not start ${provider} login.`);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      await signOutBackend();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out cleanly.");
    }
    setUser(null);
    setAdminRole(null);
    setShowAdminConsole(false);
    setAdminTreeMode(false);
    setTrees([]);
    setActiveTree(null);
    setSharingTreeId(null);
    setSharing(null);
    setSharingError("");
    setShowAccountSettings(false);
    setSettingsTreeId(null);
    setPublishModalOpen(false);
    setPublishInitialTreeId(null);
    setPublishStatusByTreeId({});
    setGithubConnection(null);
    setGithubError("");
    setBusy(false);
  };

  const handleCreateTree = async (details: NewTreeDetails) => {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const record = await createFamilyTree(user.id, {
        name: details.name,
        founderName: details.founderName,
        founderGender: details.founderGender,
        invites: details.invites,
      });
      setTrees((list) => [record, ...list.filter((tree) => tree.id !== record.id)]);
      setActiveTree(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create tree.");
    } finally {
      setBusy(false);
    }
  };

  const refreshSharing = async (treeId: string) => {
    setSharingError("");
    const nextSharing = await listFamilyTreeSharing(treeId);
    setSharing(nextSharing);
  };

  const openSharing = async (treeId: string) => {
    setSharingTreeId(treeId);
    setSharing(null);
    setSharingError("");
    setBusy(true);
    try {
      await refreshSharing(treeId);
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : "Could not load sharing.");
    } finally {
      setBusy(false);
    }
  };

  const closeSharing = () => {
    setSharingTreeId(null);
    setSharing(null);
    setSharingError("");
  };

  const inviteTreeMember = async (treeId: string, invite: TreeInviteInput) => {
    setBusy(true);
    setSharingError("");
    try {
      await inviteFamilyTreeMember(treeId, invite);
      await refreshSharing(treeId);
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : "Could not invite that person.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const changeMemberRole = async (treeId: string, userId: string, role: Exclude<TreeRole, "owner">) => {
    setBusy(true);
    setSharingError("");
    try {
      await updateFamilyTreeMemberRole(treeId, userId, role);
      await refreshSharing(treeId);
      if (userId === user?.id) await refreshTrees(user);
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : "Could not update that role.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const deleteMember = async (treeId: string, userId: string) => {
    setBusy(true);
    setSharingError("");
    try {
      await removeFamilyTreeMember(treeId, userId);
      await refreshSharing(treeId);
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : "Could not remove that person.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const changeInvitationRole = async (invitationId: string, role: Exclude<TreeRole, "owner">) => {
    if (!sharingTreeId) return;
    setBusy(true);
    setSharingError("");
    try {
      await updateFamilyTreeInvitationRole(invitationId, role);
      await refreshSharing(sharingTreeId);
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : "Could not update that invitation.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const deleteInvitation = async (invitationId: string) => {
    if (!sharingTreeId) return;
    setBusy(true);
    setSharingError("");
    try {
      await removeFamilyTreeInvitation(invitationId);
      await refreshSharing(sharingTreeId);
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : "Could not cancel that invitation.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const renameTree = async (id: string, name: string) => {
    setBusy(true);
    setError("");
    try {
      await renameFamilyTree(id, name);
      const trimmed = name.trim();
      setTrees((list) => list.map((tree) => (tree.id === id ? { ...tree, name: trimmed } : tree)));
      setActiveTree((current) => (current && current.id === id ? { ...current, name: trimmed } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename tree.");
    } finally {
      setBusy(false);
    }
  };

  const deleteTree = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await deleteFamilyTree(id);
      setTrees((list) => list.filter((tree) => tree.id !== id));
      if (activeTreeRef.current?.id === id) {
        activeTreeRef.current = null;
        setActiveTree(null);
      }
      setSettingsTreeId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this tree.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const openTree = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const record = await loadFamilyTree(id);
      if (!record) throw new Error("That family tree could not be found.");
      setSharedBranches(await listTLinkSharedBranchesForTree(id));
      setActiveTree(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open tree.");
    } finally {
      setBusy(false);
    }
  };

  const openTreeSettings = (id: string) => setSettingsTreeId(id);
  const closeTreeSettings = () => setSettingsTreeId(null);

  const openPublish = (id?: string) => {
    setSettingsTreeId(null);
    setPublishInitialTreeId(id ?? null);
    setPublishModalOpen(true);
  };
  const closePublish = () => setPublishModalOpen(false);

  const openSharingFromSettings = (id: string) => {
    setSettingsTreeId(null);
    void openSharing(id);
  };

  const connectGithub = async (): Promise<GitHubConnection | null> => {
    setGithubBusy(true);
    setGithubError("");
    try {
      if (isGitHubBackendAvailable()) {
        await startGitHubConnect();
        return null;
      }

      const connection = await mockConnectGitHub(user?.displayName || user?.email || "family-tree-user");
      setGithubConnection(connection);
      return connection;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not connect to GitHub.";
      setGithubError(message);
      throw err;
    } finally {
      setGithubBusy(false);
    }
  };

  const disconnectGithub = async () => {
    setGithubBusy(true);
    setGithubError("");
    try {
      if (isGitHubBackendAvailable()) await disconnectGitHub();
      else await mockDisconnectGitHub();
      setGithubConnection(null);
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "Could not disconnect GitHub.");
    } finally {
      setGithubBusy(false);
    }
  };

  const loadGitHubRepos = async (_username: string): Promise<GitHubRepoOption[]> => {
    if (isGitHubBackendAvailable()) return listGitHubRepositories();
    return mockListGitHubRepos(_username);
  };

  const publishTree = async (input: PublishRequestInput) => {
    if (!githubConnection) throw new Error("Connect GitHub before publishing.");
    const result = isGitHubBackendAvailable()
      ? await publishTreeWebsite(input)
      : await mockPublishTree(input, githubConnection.username);
    setPublishStatusByTreeId((current) => ({
      ...current,
      [input.treeId]: {
        state: "published",
        url: result.url,
        repoFullName: result.repoFullName,
        visibility: input.visibility,
        publishedAt: result.publishedAt ?? new Date().toISOString(),
      },
    }));
    return result;
  };

  const updateProfile = async (name: string) => {
    setBusy(true);
    setError("");
    try {
      setUser(await updateUserProfile(name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    setBusy(true);
    setError("");
    try {
      await deleteAccount();
      setUser(null);
      setTrees([]);
      setActiveTree(null);
      setShowAccountSettings(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete your account.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <><div className="app-shell auth-shell auth-loading">Loading family workspace...</div><InstallAppChoice /></>;

  if (!user) {
    return (
      <>
        <LoginScreen
          busy={busy}
          error={error}
          onAuthenticated={signIn}
          onCreateAccount={signUp}
          onSocialAuthenticated={signInSocial}
        />
        <InstallAppChoice />
      </>
    );
  }

  if (showAccountSettings) {
    return (
      <>
        <AccountSettings
        user={accountUser(user)}
        provider={user.provider}
        trees={trees}
          githubConnection={githubConnection}
          githubBusy={githubBusy}
          githubError={githubError}
          busy={busy}
          error={error}
        onBack={() => {
          setShowAccountSettings(false);
          void listTLinkRequests().then((requests) => setPendingTLinkCount(requests.filter((request) => request.direction === "incoming" && request.status === "pending").length)).catch(() => undefined);
        }}
          onUpdateProfile={updateProfile}
          onConnectGithub={() => connectGithub().then(() => undefined)}
          onDisconnectGithub={disconnectGithub}
          onSignOut={signOut}
          onDeleteAccount={removeAccount}
        />
        <InstallAppChoice />
      </>
    );
  }

  if (showAdminConsole && adminRole && !activeTree) {
    return (
      <>
        <AdminConsole
          role={adminRole}
          onBack={() => setShowAdminConsole(false)}
          onOpenTree={async (treeId) => {
            setAdminTreeMode(true);
            await openTree(treeId);
          }}
        />
        <InstallAppChoice />
      </>
    );
  }

  const sharingTree = trees.find((tree) => tree.id === sharingTreeId) ?? null;
  const settingsTree = trees.find((tree) => tree.id === settingsTreeId) ?? null;
  const ownedTrees: PublishableTree[] = trees
    .filter((tree) => tree.role === "owner")
    .map((tree) => ({
      id: tree.id,
      name: tree.name,
      status: publishStatusByTreeId[tree.id] ?? { state: "unpublished" },
    }));

  const mainScreen = !activeTree ? (
    <Dashboard
      user={accountUser(user)}
      trees={dashboardTrees}
      busy={busy}
      error={error}
      onOpenTree={openTree}
      onCreateTree={handleCreateTree}
      onRenameTree={renameTree}
      onOpenSharing={openSharing}
      onOpenTreeSettings={openTreeSettings}
      onOpenAccountSettings={() => setShowAccountSettings(true)}
      onOpenAdminConsole={adminRole ? () => setShowAdminConsole(true) : undefined}
      onOpenPublish={() => openPublish()}
      onSignOut={signOut}
      pendingTLinkCount={pendingTLinkCount}
    />
  ) : (
    <App
      key={activeTree.id}
      treeId={activeTree.id}
      treeLabel={activeTree.name}
      family={activeTree.root}
      sharedBranches={sharedBranches}
      initialSnapshot={activeTree.snapshot}
      snapshotRevision={activeTree.updatedAt}
      canEdit={activeTree.role !== "viewer"}
      onSaveTreeSnapshot={(snapshot) => {
        return saveActiveTreeSnapshot(activeTree.id, snapshot).catch((err) => {
          setError(err instanceof Error ? err.message : "Could not save tree.");
          throw err;
        });
      }}
      onOpenDashboard={() => {
        setActiveTree(null);
        setSharedBranches([]);
        if (adminTreeMode) {
          setShowAdminConsole(true);
          setAdminTreeMode(false);
          return;
        }
        if (user) void refreshTrees(user).catch((err) => setError(err instanceof Error ? err.message : "Could not refresh trees."));
      }}
      onConnectTLink={(localPersonId, tlinkId, scope) => sendTLinkRequest(activeTree.id, localPersonId, tlinkId, scope)}
      accountMenu={
        <AccountMenu
          user={accountUser(user)}
          onSwitchTree={() => setActiveTree(null)}
          onOpenAccountSettings={() => setShowAccountSettings(true)}
          onOpenAdminConsole={adminRole ? () => {
            setActiveTree(null);
            setShowAdminConsole(true);
          } : undefined}
          onSignOut={signOut}
          pendingTLinkCount={pendingTLinkCount}
        />
      }
    />
  );

  return (
    <>
      {mainScreen}
      <InstallAppChoice />

      <ShareTreeModal
        open={Boolean(sharingTree)}
        treeName={sharingTree?.name ?? ""}
        sharing={sharing}
        busy={busy}
        error={sharingError}
        onClose={closeSharing}
        onInvite={(invite) => (sharingTree ? inviteTreeMember(sharingTree.id, invite) : undefined)}
        onMemberRole={(userId, role) => (sharingTree ? changeMemberRole(sharingTree.id, userId, role) : undefined)}
        onRemoveMember={(userId) => (sharingTree ? deleteMember(sharingTree.id, userId) : undefined)}
        onInvitationRole={changeInvitationRole}
        onRemoveInvitation={deleteInvitation}
      />

      <TreeSettingsModal
        open={Boolean(settingsTree)}
        tree={settingsTree}
        publishStatus={settingsTree ? publishStatusByTreeId[settingsTree.id] ?? { state: "unpublished" } : null}
        busy={busy}
        error={error}
        onClose={closeTreeSettings}
        onRename={renameTree}
        onOpenSharing={openSharingFromSettings}
        onOpenPublish={openPublish}
        onDelete={deleteTree}
      />

      <PublishWebsiteModal
        open={publishModalOpen}
        onClose={closePublish}
        trees={ownedTrees}
        initialTreeId={publishInitialTreeId}
        githubConnection={githubConnection}
        onConnectGithub={connectGithub}
        onLoadRepos={loadGitHubRepos}
        onPublish={publishTree}
      />
    </>
  );
}
