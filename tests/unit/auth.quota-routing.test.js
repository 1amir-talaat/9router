import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetProviderConnections = vi.fn();
const mockUpdateProviderConnection = vi.fn();
const mockGetSettings = vi.fn();
const mockResolveConnectionProxyConfig = vi.fn();
const mockValidateApiKey = vi.fn();

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: mockGetProviderConnections,
  updateProviderConnection: mockUpdateProviderConnection,
  getSettings: mockGetSettings,
  validateApiKey: mockValidateApiKey,
}));

vi.mock("../../src/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: mockResolveConnectionProxyConfig,
}));

describe("quota-aware auth routing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({ fallbackStrategy: "fill-first", providerStrategies: {} });
    mockResolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      proxyPoolId: null,
      vercelRelayUrl: "",
    });
  });

  it("prefers quota-available accounts over unknown and exhausted ones", async () => {
    mockGetProviderConnections.mockResolvedValue([
      { id: "exhausted", provider: "codex", isActive: true, priority: 1, accessToken: "x", quotaState: "exhausted", quotaResetAt: new Date(Date.now() + 60_000).toISOString() },
      { id: "unknown", provider: "codex", isActive: true, priority: 2, accessToken: "y" },
      { id: "available", provider: "codex", isActive: true, priority: 3, accessToken: "z", quotaState: "available" },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-5-codex");

    expect(credentials.connectionId).toBe("available");
  });

  it("returns allQuotaExhausted when every candidate is exhausted", async () => {
    const retryAfter = new Date(Date.now() + 120_000).toISOString();
    mockGetProviderConnections.mockResolvedValue([
      { id: "one", provider: "codex", isActive: true, priority: 1, accessToken: "x", quotaState: "exhausted", quotaResetAt: retryAfter },
      { id: "two", provider: "codex", isActive: true, priority: 2, accessToken: "y", quotaState: "exhausted", quotaResetAt: new Date(Date.now() + 240_000).toISOString() },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const result = await getProviderCredentials("codex", null, "gpt-5-codex");

    expect(result.allQuotaExhausted).toBe(true);
    expect(result.retryAfter).toBe(retryAfter);
  });

  it("sticky prefers the most recently used routable account", async () => {
    mockGetSettings.mockResolvedValue({ fallbackStrategy: "sticky", providerStrategies: {} });
    mockGetProviderConnections.mockResolvedValue([
      { id: "older", provider: "codex", isActive: true, priority: 1, accessToken: "x", lastUsedAt: "2026-04-21T10:00:00.000Z" },
      { id: "newer", provider: "codex", isActive: true, priority: 2, accessToken: "y", lastUsedAt: "2026-04-21T11:00:00.000Z" },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex");

    expect(credentials.connectionId).toBe("newer");
    expect(mockUpdateProviderConnection).toHaveBeenCalledWith("newer", expect.objectContaining({ lastUsedAt: expect.any(String) }));
  });

  it("sticky falls back when the last used account is excluded", async () => {
    mockGetSettings.mockResolvedValue({ fallbackStrategy: "sticky", providerStrategies: {} });
    mockGetProviderConnections.mockResolvedValue([
      { id: "older", provider: "codex", isActive: true, priority: 1, accessToken: "x", lastUsedAt: "2026-04-21T10:00:00.000Z" },
      { id: "newer", provider: "codex", isActive: true, priority: 2, accessToken: "y", lastUsedAt: "2026-04-21T11:00:00.000Z" },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", "newer");

    expect(credentials.connectionId).toBe("older");
  });

  it("round-robin prefers the least recently used routable account on each request", async () => {
    mockGetSettings.mockResolvedValue({ fallbackStrategy: "round-robin", providerStrategies: {} });
    mockGetProviderConnections.mockResolvedValue([
      { id: "older", provider: "codex", isActive: true, priority: 1, accessToken: "x", lastUsedAt: "2026-04-21T10:00:00.000Z" },
      { id: "newer", provider: "codex", isActive: true, priority: 2, accessToken: "y", lastUsedAt: "2026-04-21T11:00:00.000Z" },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex");

    expect(credentials.connectionId).toBe("older");
    expect(mockUpdateProviderConnection).toHaveBeenCalledWith("older", expect.objectContaining({ lastUsedAt: expect.any(String) }));
  });

  it("provider override takes precedence over the global default", async () => {
    mockGetSettings.mockResolvedValue({
      fallbackStrategy: "fill-first",
      providerStrategies: { codex: { fallbackStrategy: "sticky" } },
    });
    mockGetProviderConnections.mockResolvedValue([
      { id: "first", provider: "codex", isActive: true, priority: 1, accessToken: "x", lastUsedAt: "2026-04-21T10:00:00.000Z" },
      { id: "second", provider: "codex", isActive: true, priority: 2, accessToken: "y", lastUsedAt: "2026-04-21T11:00:00.000Z" },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex");

    expect(credentials.connectionId).toBe("second");
  });

  it("marks hard quota failures as exhausted state", async () => {
    mockGetProviderConnections.mockResolvedValue([
      { id: "one", provider: "codex", isActive: true, priority: 1, accessToken: "x", backoffLevel: 0 },
    ]);

    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable("one", 403, "You exceeded your current quota. Resets after 5m", "codex", "gpt-5-codex");

    expect(result.shouldFallback).toBe(true);
    expect(mockUpdateProviderConnection).toHaveBeenCalledWith("one", expect.objectContaining({
      quotaState: "exhausted",
      quotaSource: "inferred",
      quotaSummary: expect.objectContaining({ hasRemaining: false }),
    }));
  });
});

describe("quota state normalization", () => {
  it("marks multi-window providers exhausted when any blocking window is exhausted", async () => {
    const { normalizeQuotaState } = await import("../../src/sse/services/quotaState.js");

    const normalized = normalizeQuotaState("codex", {
      quotas: {
        session: { used: 100, total: 100, remaining: 0, resetAt: new Date(Date.now() + 60_000).toISOString(), unlimited: false },
        weekly: { used: 25, total: 100, remaining: 75, resetAt: new Date(Date.now() + 120_000).toISOString(), unlimited: false },
      },
    });

    expect(normalized.quotaState).toBe("exhausted");
    expect(normalized.quotaResetAt).toBeTruthy();
    expect(normalized.quotaSummary.exhaustedWindows).toContain("session");
  });
});
