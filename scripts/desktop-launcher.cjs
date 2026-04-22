#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = process.env.NINE_ROUTER_REPO_ROOT || path.resolve(__dirname, "..");
const electronExecutable = process.platform === "win32"
  ? path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe")
  : path.join(repoRoot, "node_modules", ".bin", "electron");
const mainProcessFile = path.join(repoRoot, "desktop", "main.cjs");
const forwardedArgs = process.argv.slice(2);
const childEnv = {
  ...process.env,
  NINE_ROUTER_NODE_EXECUTABLE: process.execPath,
  NINE_ROUTER_REPO_ROOT: repoRoot,
};

// Some shells export this for Electron's Node-only mode, which breaks the tray app.
delete childEnv.ELECTRON_RUN_AS_NODE;

if (!fs.existsSync(electronExecutable)) {
  console.error("Electron is not installed in this repo. Run `npm install` in the project first.");
  process.exit(1);
}

const child = process.platform === "win32"
  ? spawn(
      electronExecutable,
      [mainProcessFile, ...forwardedArgs],
      {
        cwd: repoRoot,
        stdio: "inherit",
        env: childEnv,
        windowsHide: true,
      }
    )
  : spawn(electronExecutable, [mainProcessFile, ...forwardedArgs], {
      cwd: repoRoot,
      stdio: "inherit",
      env: childEnv,
    });

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
