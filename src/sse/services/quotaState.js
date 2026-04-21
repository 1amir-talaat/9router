function toIsoString(value) {
  if (!value) return null;

  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

function getFutureIso(values = []) {
  const now = Date.now();
  let earliest = null;

  for (const value of values) {
    const iso = toIsoString(value);
    if (!iso) continue;
    const time = new Date(iso).getTime();
    if (time <= now) continue;
    if (!earliest || time < earliest) earliest = time;
  }

  return earliest ? new Date(earliest).toISOString() : null;
}

function normalizeQuotaWindow(name, quota) {
  if (!quota || typeof quota !== "object") return null;

  const unlimited = quota.unlimited === true;
  const resetAt = toIsoString(quota.resetAt);

  let remaining = null;
  if (typeof quota.remainingPercentage === "number") {
    remaining = quota.remainingPercentage;
  } else if (typeof quota.remaining === "number") {
    remaining = quota.remaining;
  } else if (typeof quota.used === "number" && typeof quota.total === "number" && quota.total > 0) {
    remaining = quota.total - quota.used;
  }

  const known = unlimited || typeof remaining === "number";
  const exhausted = !unlimited && typeof remaining === "number" ? remaining <= 0 : false;
  const hasRemaining = unlimited || (typeof remaining === "number" && remaining > 0);

  return {
    name,
    unlimited,
    known,
    exhausted,
    hasRemaining,
    remaining,
    resetAt,
  };
}

export function normalizeQuotaState(provider, usage) {
  const quotas = usage?.quotas && typeof usage.quotas === "object"
    ? Object.entries(usage.quotas)
      .map(([name, quota]) => normalizeQuotaWindow(name, quota))
      .filter(Boolean)
    : [];

  const knownWindows = quotas.filter((quota) => quota.known);
  const exhaustedWindows = knownWindows.filter((quota) => quota.exhausted);
  const availableWindows = knownWindows.filter((quota) => quota.hasRemaining);
  const lowestRemaining = knownWindows
    .filter((quota) => typeof quota.remaining === "number")
    .reduce((lowest, quota) => Math.min(lowest, quota.remaining), Infinity);

  const quotaSummary = {
    provider,
    message: usage?.message || null,
    plan: usage?.plan || null,
    hasRemaining: availableWindows.length > 0,
    remainingPercentage: Number.isFinite(lowestRemaining) ? Math.max(0, Math.round(lowestRemaining)) : null,
    exhaustedWindows: exhaustedWindows.map((quota) => quota.name),
  };

  if (usage?.limitReached === true || exhaustedWindows.length > 0) {
    return {
      quotaState: "exhausted",
      quotaResetAt: getFutureIso([
        usage?.resetDate,
        ...exhaustedWindows.map((quota) => quota.resetAt),
        ...knownWindows.map((quota) => quota.resetAt),
      ]),
      quotaSummary,
    };
  }

  if (availableWindows.length > 0) {
    return {
      quotaState: "available",
      quotaResetAt: null,
      quotaSummary,
    };
  }

  return {
    quotaState: "unknown",
    quotaResetAt: null,
    quotaSummary,
  };
}

export function buildQuotaStateUpdate(provider, usage, source = "api") {
  const normalized = normalizeQuotaState(provider, usage);

  return {
    quotaState: normalized.quotaState,
    quotaCheckedAt: new Date().toISOString(),
    quotaResetAt: normalized.quotaResetAt,
    quotaSource: source,
    quotaSummary: normalized.quotaSummary,
  };
}

export function getEffectiveQuotaRoutingState(connection) {
  const quotaState = connection?.quotaState || "unknown";
  const quotaResetAt = toIsoString(connection?.quotaResetAt);

  if (quotaState === "exhausted" && quotaResetAt && new Date(quotaResetAt).getTime() <= Date.now()) {
    return { state: "unknown", resetAt: null };
  }

  return { state: quotaState, resetAt: quotaResetAt };
}

export function getEarliestQuotaResetAt(connections = []) {
  return getFutureIso(connections.map((connection) => connection?.quotaResetAt));
}

function parseDurationReset(text) {
  const match = text.match(/reset(?:s)?\s+(?:after|in)\s+((?:\d+\s*h\s*)?(?:\d+\s*m\s*)?(?:\d+\s*s\s*)?)/i);
  if (!match) return null;

  const durationText = match[1] || "";
  const hours = Number(durationText.match(/(\d+)\s*h/i)?.[1] || 0);
  const minutes = Number(durationText.match(/(\d+)\s*m/i)?.[1] || 0);
  const seconds = Number(durationText.match(/(\d+)\s*s/i)?.[1] || 0);
  const durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000;

  if (durationMs <= 0) return null;
  return new Date(Date.now() + durationMs).toISOString();
}

export function extractQuotaResetAtFromError(errorText) {
  if (!errorText) return null;
  const text = typeof errorText === "string" ? errorText : JSON.stringify(errorText);

  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
  if (isoMatch?.[0]) return toIsoString(isoMatch[0]);

  return parseDurationReset(text);
}

export function isHardQuotaError(status, errorText) {
  const text = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  if (!text) return false;

  const quotaPatterns = [
    "insufficient quota",
    "quota exceeded",
    "exceeded your current quota",
    "usage limit",
    "limit reached",
    "quota has been exhausted",
    "monthly quota",
    "weekly quota",
    "daily quota",
    "credit balance is too low",
  ];

  const matched = quotaPatterns.some((pattern) => text.includes(pattern));
  if (!matched) return false;

  return [403, 429].includes(Number(status));
}
