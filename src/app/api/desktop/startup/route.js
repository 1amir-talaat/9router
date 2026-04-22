import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { updateSettings } from "@/lib/localDb";

const STARTUP_FILE = "9router.vbs";
const LEGACY_STARTUP_FILE = "9router.cmd";

function getStartupDir() {
  return path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup"
  );
}

function escapeVbsString(value) {
  return value.replaceAll("\"", "\"\"");
}

function buildStartupScript() {
  const repoRoot = process.cwd();
  const electronPath = path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe");
  const mainProcessPath = path.join(repoRoot, "desktop", "main.cjs");
  return [
    "Set shell = CreateObject(\"WScript.Shell\")",
    "Set fso = CreateObject(\"Scripting.FileSystemObject\")",
    `electronExe = "${escapeVbsString(electronPath)}"`,
    `mainFile = "${escapeVbsString(mainProcessPath)}"`,
    "If Not fso.FileExists(electronExe) Then",
    "  WScript.Quit 1",
    "End If",
    "command = \"cmd.exe /c set \"\"ELECTRON_RUN_AS_NODE=\"\" && \" & Chr(34) & electronExe & Chr(34) & \" \" & Chr(34) & mainFile & Chr(34) & \" --hidden\"",
    "shell.Run command, 0, False",
    "",
  ].join("\r\n");
}

export async function PATCH(request) {
  if (process.platform !== "win32") {
    return NextResponse.json({ error: "Windows startup is only available on Windows." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const enabled = body?.enabled === true;
    const startupDir = getStartupDir();
    const startupFilePath = path.join(startupDir, STARTUP_FILE);
    const legacyStartupFilePath = path.join(startupDir, LEGACY_STARTUP_FILE);

    await fs.mkdir(startupDir, { recursive: true });
    if (enabled) {
      await fs.writeFile(startupFilePath, buildStartupScript(), "utf8");
      await fs.rm(legacyStartupFilePath, { force: true });
    } else {
      await fs.rm(startupFilePath, { force: true });
      await fs.rm(legacyStartupFilePath, { force: true });
    }

    const settings = await updateSettings({ desktopLaunchAtLogin: enabled });
    return NextResponse.json({ ok: true, desktopLaunchAtLogin: settings.desktopLaunchAtLogin === true });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to update Windows startup." }, { status: 500 });
  }
}
