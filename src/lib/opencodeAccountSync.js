import fs from "node:fs/promises";
import path from "node:path";
import { createProviderConnection } from "@/models";
import { getUserHomeDir } from "@/lib/userHome";

const OPENCODE_DIR = path.join(getUserHomeDir(), ".config", "opencode");
const CODEX_ACCOUNTS_PATH = path.join(OPENCODE_DIR, "codex-accounts.json");
const ANTIGRAVITY_ACCOUNTS_PATH = path.join(OPENCODE_DIR, "antigravity-accounts.json");

async function readJson(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function toIsoTimestamp(value) {
  if (!value) return null;
  const timestamp = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp).toISOString();
}

async function syncCodexAccounts() {
  const data = await readJson(CODEX_ACCOUNTS_PATH);
  const accounts = Array.isArray(data?.openai?.accounts) ? data.openai.accounts : [];

  for (const account of accounts) {
    if (!account?.enabled || !account?.email || !account?.refresh) continue;

    await createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: account.email,
      displayName: account.plan ? `${account.email} (${account.plan})` : account.email,
      accessToken: account.access || null,
      refreshToken: account.refresh,
      expiresAt: toIsoTimestamp(account.expires),
      isActive: account.enabled !== false,
      testStatus: "active",
      providerSpecificData: {
        authMethod: "opencode-import",
        source: "opencode",
        accountId: account.accountId || null,
        plan: account.plan || null,
        identityKey: account.identityKey || null,
        authTypes: Array.isArray(account.authTypes) ? account.authTypes : [],
        lastUsed: account.lastUsed || null,
        cooldownUntil: account.cooldownUntil || null,
      },
    });
  }
}

async function syncAntigravityAccounts() {
  const data = await readJson(ANTIGRAVITY_ACCOUNTS_PATH);
  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];

  for (const account of accounts) {
    if (!account?.enabled || !account?.email || !account?.refreshToken) continue;

    await createProviderConnection({
      provider: "antigravity",
      authType: "oauth",
      email: account.email,
      displayName: account.email,
      refreshToken: account.refreshToken,
      isActive: account.enabled !== false,
      testStatus: "active",
      providerSpecificData: {
        authMethod: "opencode-import",
        source: "opencode",
        addedAt: account.addedAt || null,
        lastUsed: account.lastUsed || null,
        rateLimitResetTimes: account.rateLimitResetTimes || {},
        cachedQuota: account.cachedQuota || {},
        cachedQuotaUpdatedAt: account.cachedQuotaUpdatedAt || null,
        fingerprint: account.fingerprint || null,
        fingerprintHistory: Array.isArray(account.fingerprintHistory) ? account.fingerprintHistory : [],
      },
    });
  }
}

export async function syncOpenCodeAccounts(providerId = null) {
  if (!providerId || providerId === "codex") {
    await syncCodexAccounts();
  }

  if (!providerId || providerId === "antigravity") {
    await syncAntigravityAccounts();
  }
}
