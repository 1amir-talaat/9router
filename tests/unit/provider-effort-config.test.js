import { describe, it, expect } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

describe("provider effort config", () => {
  it("codex preserves auto by omitting reasoning effort", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.4",
      input: [{ role: "user", content: "hi" }],
      reasoning_effort: "auto",
    };

    const result = executor.transformRequest("gpt-5.4", { ...body }, true, {});

    expect(result.reasoning).toBeUndefined();
    expect(result.reasoning_effort).toBeUndefined();
  });

  it("codex forwards explicit selected effort", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.4",
      input: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    };

    const result = executor.transformRequest("gpt-5.4", { ...body }, true, {});

    expect(result.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(result.include).toEqual(["reasoning.encrypted_content"]);
    expect(result.reasoning_effort).toBeUndefined();
  });

  it("codex forwards fast service tier and strips auto", () => {
    const executor = new CodexExecutor();

    const fastResult = executor.transformRequest("gpt-5.4", {
      model: "gpt-5.4",
      input: [{ role: "user", content: "hi" }],
      service_tier: "fast",
    }, true, {});

    const autoResult = executor.transformRequest("gpt-5.4", {
      model: "gpt-5.4",
      input: [{ role: "user", content: "hi" }],
      service_tier: "auto",
    }, true, {});

    expect(fastResult.service_tier).toBe("fast");
    expect(autoResult.service_tier).toBeUndefined();
  });

  it("opencode strips auto effort but preserves explicit effort", () => {
    const executor = new OpenCodeExecutor();

    const autoResult = executor.transformRequest("qwen3.6-plus-free", {
      model: "qwen3.6-plus-free",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "auto",
    });

    const highResult = executor.transformRequest("qwen3.6-plus-free", {
      model: "qwen3.6-plus-free",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    });

    expect(autoResult.reasoning_effort).toBeUndefined();
    expect(highResult.reasoning_effort).toBe("high");
  });
});
