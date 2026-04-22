const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { app, Menu, Tray, nativeImage, shell } = require("electron");

const repoRoot = process.env.NINE_ROUTER_REPO_ROOT || path.resolve(__dirname, "..");
const iconPath = path.join(repoRoot, "src", "app", "favicon.ico");
const devServerUrl = process.env.NINE_ROUTER_BASE_URL || "http://127.0.0.1:20128";
const dashboardUrl = `${devServerUrl}/dashboard`;
const buildOutputPath = path.join(repoRoot, ".next", "BUILD_ID");
const isHiddenLaunch = process.argv.includes("--hidden");
const nodeExecutable = process.env.NINE_ROUTER_NODE_EXECUTABLE || process.execPath;
const npmCliPath = process.platform === "win32"
  ? path.join(path.dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js")
  : null;

let tray = null;
let serverProcess = null;
let ownsServer = false;
let launchAtLoginEnabled = false;
let quitting = false;

app.setName("9Router");
if (process.platform === "win32") {
  app.setAppUserModelId("com.9router.local");
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void openDashboard();
  });
}

function getIcon() {
  if (!fs.existsSync(iconPath)) return undefined;
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Dashboard", click: () => { void openDashboard(); } },
    {
      label: launchAtLoginEnabled ? "Disable Start With Windows" : "Enable Start With Windows",
      click: () => { void setLaunchAtLogin(!launchAtLoginEnabled); },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
}

function requestJson(urlPath = "/api/settings") {
  return new Promise((resolve, reject) => {
    const req = http.get(`${devServerUrl}${urlPath}`, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("Request timed out")));
  });
}

async function isServerReachable() {
  try {
    await requestJson();
    return true;
  } catch {
    return false;
  }
}

async function ensureServerRunning() {
  if (await isServerReachable()) return;

  const serverScript = fs.existsSync(buildOutputPath) ? "start" : "dev";
  ownsServer = true;
  const command = process.platform === "win32" ? nodeExecutable : "npm";
  const args = process.platform === "win32"
    ? [npmCliPath, "run", serverScript]
    : ["run", serverScript];

  if (process.platform === "win32" && !fs.existsSync(npmCliPath)) {
    throw new Error(`npm CLI not found at ${npmCliPath}`);
  }

  serverProcess = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: "20128",
      HOSTNAME: "127.0.0.1",
      NEXT_PUBLIC_BASE_URL: devServerUrl,
      BASE_URL: devServerUrl,
      BROWSER: "none",
    },
    stdio: "inherit",
    windowsHide: true,
  });

  serverProcess.on("exit", (code) => {
    if (!quitting && code && code !== 0) {
      console.error(`9Router server (${serverScript}) exited with code ${code}`);
    }
  });

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await isServerReachable()) return;
    await wait(1500);
  }

  throw new Error("Timed out waiting for the 9Router server to start.");
}

async function openDashboard() {
  await shell.openExternal(dashboardUrl);
}

async function syncSettingsFromServer() {
  try {
    const settings = await requestJson();
    launchAtLoginEnabled = settings.desktopLaunchAtLogin === true;
    updateTrayMenu();
  } catch {
    // Ignore sync failures and keep current behavior.
  }
}

function requestJsonWithBody(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(`${devServerUrl}${urlPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(responseBody ? JSON.parse(responseBody) : {});
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("Request timed out")));
    req.write(payload);
    req.end();
  });
}

async function setLaunchAtLogin(enabled) {
  try {
    const result = await requestJsonWithBody("PATCH", "/api/desktop/startup", { enabled });
    launchAtLoginEnabled = result.desktopLaunchAtLogin === true;
    updateTrayMenu();
  } catch (error) {
    console.error(error.message || error);
  }
}

function createTray() {
  if (tray) return;

  const icon = getIcon();
  tray = new Tray(icon);
  tray.setToolTip("9Router");
  tray.on("double-click", () => { void openDashboard(); });
  updateTrayMenu();
}

function killOwnedServer() {
  if (!ownsServer || !serverProcess) return;
  try {
    serverProcess.kill();
  } catch {
    // Ignore shutdown failures.
  }
}

app.on("before-quit", () => {
  quitting = true;
  killOwnedServer();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.whenReady().then(async () => {
  try {
    await ensureServerRunning();
    await syncSettingsFromServer();
    createTray();
    if (!isHiddenLaunch) {
      await openDashboard();
    }
  } catch (error) {
    console.error(error.message || error);
    app.quit();
  }
});
