#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const launcher = path.join(repoRoot, "scripts", "desktop-launcher.cjs");
const args = process.argv.slice(2);
const runForeground = args.includes("--foreground");
const forwardedArgs = args.filter((arg) => arg !== "--foreground");

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: 9router [--hidden] [--foreground]");
  process.exit(0);
}

const shouldDetach = process.platform === "win32" && !runForeground;
const child = spawn(process.execPath, [launcher, ...forwardedArgs], {
  cwd: repoRoot,
  detached: shouldDetach,
  stdio: shouldDetach ? "ignore" : "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    NINE_ROUTER_REPO_ROOT: repoRoot,
  },
});

if (shouldDetach) {
  child.unref();
  process.exit(0);
}

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
