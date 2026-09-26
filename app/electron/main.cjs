const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, Menu } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const isDev = !app.isPackaged;
const APP_NAME = "Family Tree";
const LEGACY_APP_NAME = "The Ray's Family Tree";
const AUTH_PROTOCOL = "familytree";
const DEV_AUTH_CALLBACK_PORT = 5187;
const DEV_AUTH_CALLBACK_PATH = "/auth/callback";
let pendingAuthCallbackUrl = null;
let devAuthServer = null;

app.setName(APP_NAME);

function registerAuthProtocol() {
  if (isDev) return;
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL);
}

function authRedirectUrl() {
  if (isDev) return `http://127.0.0.1:${DEV_AUTH_CALLBACK_PORT}${DEV_AUTH_CALLBACK_PATH}`;
  return `${AUTH_PROTOCOL}://auth/callback`;
}

function startDevAuthCallbackServer() {
  if (!isDev || devAuthServer) return;

  devAuthServer = http.createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${DEV_AUTH_CALLBACK_PORT}`);
    if (requestUrl.pathname !== DEV_AUTH_CALLBACK_PATH) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    sendAuthCallback(requestUrl.toString());
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Family Tree Login</title></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#05070d; color:#e6f4ff; display:grid; place-items:center; min-height:100vh; margin:0;">
    <main style="text-align:center; max-width:480px;">
      <h1>Family Tree login complete</h1>
      <p>You can return to the Family Tree Mac app.</p>
    </main>
  </body>
</html>`);
  });

  devAuthServer.on("error", (err) => {
    console.warn(`Could not start local auth callback server: ${err.message}`);
    devAuthServer = null;
  });

  devAuthServer.listen(DEV_AUTH_CALLBACK_PORT, "127.0.0.1");
}

function sendAuthCallback(url) {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    pendingAuthCallbackUrl = url;
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
  win.webContents.send("auth:callback-url", url);
}

// Two instances writing family-edits.json at once can silently drop whichever
// save loses the race, so refuse a second launch and just focus the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", (_event, argv) => {
  const win = BrowserWindow.getAllWindows()[0];
  const callbackUrl = argv.find((arg) => arg.startsWith(`${AUTH_PROTOCOL}://`));
  if (callbackUrl) sendAuthCallback(callbackUrl);
  else if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  sendAuthCallback(url);
});

function appIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "../build/icon.png");
}

function applyDockIcon() {
  if (process.platform !== "darwin" || !app.dock) return;
  let icon = nativeImage.createFromPath(appIconPath());
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(path.join(process.resourcesPath, "icon.icns"));
  }
  if (!icon.isEmpty()) app.dock.setIcon(icon);
}

function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const isDev = !app.isPackaged;

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: (_item, win) => win?.webContents.send("menu:save"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          click: (_item, win) => win?.webContents.send("menu:undo"),
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        ...(isDev
          ? [
              { role: "reload" },
              { role: "forceReload" },
              { role: "toggleDevTools" },
              { type: "separator" },
            ]
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function dataFilePath() {
  return path.join(app.getPath("userData"), "family-edits.json");
}

function settingsFilePath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function legacyUserDataPath(fileName) {
  return path.join(app.getPath("appData"), LEGACY_APP_NAME, fileName);
}

async function migrateLegacyFile(fileName) {
  const target = path.join(app.getPath("userData"), fileName);
  try {
    await fs.access(target);
    return;
  } catch {
    // No current file yet. Try copying the previous app-name data below.
  }

  try {
    const legacy = legacyUserDataPath(fileName);
    const raw = await fs.readFile(legacy, "utf8");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, raw, "utf8");
  } catch {
    // Fresh installs will not have legacy data.
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsFilePath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeSettings(settings) {
  await writeJsonFile(settingsFilePath(), settings);
}

async function isProjectRoot(candidate) {
  if (!candidate) return false;
  try {
    const packageRaw = await fs.readFile(path.join(candidate, "package.json"), "utf8");
    const packageJson = JSON.parse(packageRaw);
    await fs.access(path.join(candidate, "src/data/permanent-edits.json"));
    return packageJson.name === "the-rays-family-tree";
  } catch {
    return false;
  }
}

async function chooseProjectRoot() {
  const settings = await readSettings();
  if (await isProjectRoot(settings.projectRoot)) return settings.projectRoot;
  if (await isProjectRoot(process.cwd())) return process.cwd();

  const result = await dialog.showOpenDialog({
    title: "Choose Family Tree Project Folder",
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const selected = result.filePaths[0];
  if (!(await isProjectRoot(selected))) {
    throw new Error("Please choose the app folder that contains the family tree project.");
  }

  await writeSettings({ ...settings, projectRoot: selected });
  return selected;
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (err) => {
      resolve({ ok: false, output: err.message });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, output });
    });
  });
}

async function mustRun(command, args, cwd) {
  const result = await runCommand(command, args, cwd);
  if (!result.ok) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.output}`);
  }
  return result.output;
}

// A bare `git push` refuses to run when the current branch's name doesn't
// match its upstream's (git's push.default=simple default) — which is the
// normal case here, since admin edits often happen on a non-main branch that
// still tracks origin/main. Push explicitly to whatever the upstream is.
async function pushToUpstream(cwd) {
  const upstream = await runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);
  const slash = upstream.ok ? upstream.output.trim().indexOf("/") : -1;
  if (slash === -1) {
    await mustRun("git", ["push"], cwd);
    return;
  }
  const remote = upstream.output.trim().slice(0, slash);
  const branch = upstream.output.trim().slice(slash + 1);
  await mustRun("git", ["push", remote, `HEAD:${branch}`], cwd);
}

ipcMain.handle("family-data:load", async () => {
  try {
    const raw = await fs.readFile(dataFilePath(), "utf8");
    try {
      return { ok: true, snapshot: JSON.parse(raw) };
    } catch {
      // Corrupt save file — quarantine it and start fresh instead of getting
      // stuck in a permanent "auto-save failed" state on every future launch.
      const quarantinePath = `${dataFilePath()}.corrupt-${Date.now()}`;
      await fs.rename(dataFilePath(), quarantinePath).catch(() => {});
      console.warn(`Family data was corrupted; moved aside to ${quarantinePath}`);
      return { ok: true, snapshot: null };
    }
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: true, snapshot: null };
    return { ok: false, message: err instanceof Error ? err.message : "Could not load family data." };
  }
});

ipcMain.handle("family-data:save", async (_event, snapshot) => {
  try {
    await writeJsonFile(dataFilePath(), snapshot);
    return { ok: true, path: dataFilePath() };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not save family data." };
  }
});

ipcMain.handle("family-data:backup", async (_event, snapshot) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: "Back Up Family Tree Data",
      defaultPath: `rays-family-tree-backup-${today}.json`,
      filters: [{ name: "Family Tree Backup", extensions: ["json"] }],
    });

    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    await writeJsonFile(result.filePath, snapshot);
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not create backup." };
  }
});

ipcMain.handle("family-data:restore", async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: "Restore Family Tree Data",
      properties: ["openFile"],
      filters: [{ name: "Family Tree Backup", extensions: ["json"] }],
    });

    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    const raw = await fs.readFile(result.filePaths[0], "utf8");
    return { ok: true, snapshot: JSON.parse(raw), path: result.filePaths[0] };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not restore backup." };
  }
});

ipcMain.handle("family-publish:github", async (_event, snapshot) => {
  try {
    const projectRoot = await chooseProjectRoot();
    if (!projectRoot) return { ok: false, cancelled: true };
    // GitHub Pages serves this site from the repo root (not app/dist), so the
    // built site has to be copied up one level to actually go live.
    const repoRoot = path.dirname(projectRoot);

    await writeJsonFile(path.join(projectRoot, "src/data/permanent-edits.json"), snapshot);
    await mustRun("npm", ["run", "build:public"], projectRoot);

    // Copy every top-level entry the build produced (index.html, assets/, and
    // anything from public/ like photos/) rather than a hardcoded list, so a
    // future public/ addition doesn't silently go missing from the live site.
    const distDir = path.join(projectRoot, "dist");
    const distEntries = await fs.readdir(distDir);
    for (const entry of distEntries) {
      const dest = path.join(repoRoot, entry);
      await fs.rm(dest, { recursive: true, force: true });
      await fs.cp(path.join(distDir, entry), dest, { recursive: true });
    }

    const publishedPaths = [...distEntries, "app/src/data/permanent-edits.json"];
    await mustRun("git", ["add", ...publishedPaths], repoRoot);

    const diff = await runCommand("git", ["diff", "--cached", "--quiet", "--", ...publishedPaths], repoRoot);
    let committed = false;
    if (!diff.ok) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      await mustRun("git", ["commit", "-m", `Publish family tree update ${stamp}`, "--", ...publishedPaths], repoRoot);
      committed = true;
    }

    // Even with nothing new to commit, a previous publish attempt may have
    // committed successfully but failed to push (e.g. the push step itself
    // errored) — retrying should still push that pending commit rather than
    // reporting "no changes" and leaving it stuck forever.
    const ahead = await runCommand("git", ["rev-list", "--count", "@{u}..HEAD"], repoRoot);
    const aheadCount = ahead.ok ? parseInt(ahead.output.trim(), 10) || 0 : 0;
    if (!committed && aheadCount === 0) return { ok: true, message: "No public changes to publish." };

    await pushToUpstream(repoRoot);
    return { ok: true, message: "Published to GitHub.", projectRoot };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not publish to GitHub." };
  }
});

ipcMain.handle("window-control:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("window-control:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("window-control:toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.handle("auth:open-external", async (_event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle("auth:get-redirect-url", () => authRedirectUrl());

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    title: APP_NAME,
    icon: appIconPath(),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 24, y: 22 },
    transparent: true,
    roundedCorners: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    if (pendingAuthCallbackUrl) {
      sendAuthCallback(pendingAuthCallbackUrl);
      pendingAuthCallbackUrl = null;
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  registerAuthProtocol();
  startDevAuthCallbackServer();
  applyDockIcon();
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    iconPath: appIconPath(),
  });
  Menu.setApplicationMenu(buildAppMenu());
  await migrateLegacyFile("family-edits.json");
  await migrateLegacyFile("settings.json");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  devAuthServer?.close();
  devAuthServer = null;
});
