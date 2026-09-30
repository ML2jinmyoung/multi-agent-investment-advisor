import { afterEach, describe, expect, it, vi } from "vitest";

describe("public demo LLM policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("ignores the owner's Anthropic/OpenAI keys and answers only with the free OpenRouter model", async () => {
    vi.stubEnv("PUBLIC_DEMO_MODE", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "owner-key");
    vi.stubEnv("OPENAI_API_KEY", "owner-key");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-demo");
    const { hasProviderKey, llmAvailable, modelFor } = await import("@/providers/llm/registry");
    expect(hasProviderKey("anthropic")).toBe(false);
    expect(hasProviderKey("openai")).toBe(false);
    expect(llmAvailable()).toBe(true);
    const { config } = await modelFor("synthesizer");
    expect(config).toEqual({ provider: "openrouter", model: "qwen/qwen3.8-27b:free" });
  });

  it("refuses a paid model even if configured", async () => {
    vi.stubEnv("PUBLIC_DEMO_MODE", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-demo");
    vi.stubEnv("DEMO_LLM_MODEL", "anthropic/claude-sonnet-5");
    const { llmAvailable, modelFor } = await import("@/providers/llm/registry");
    expect(llmAvailable()).toBe(false);
    await expect(modelFor("synthesizer")).rejects.toThrow();
  });

  it("withoutLlm switches the LLM off only inside its scope", async () => {
    vi.stubEnv("PUBLIC_DEMO_MODE", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-demo");
    const { llmAvailable } = await import("@/providers/llm/registry");
    const { withoutLlm } = await import("@/providers/llm/demo");
    await withoutLlm(async () => expect(llmAvailable()).toBe(false));
    expect(llmAvailable()).toBe(true);
  });

  it("counts AI questions per session per day", async () => {
    vi.stubEnv("DEMO_QUESTIONS_PER_DAY", "2");
    const { demoQuota, takeDemoQuestion } = await import("@/providers/llm/demo");
    expect(takeDemoQuestion("a")).toBe(true);
    expect(takeDemoQuestion("a")).toBe(true);
    expect(takeDemoQuestion("a")).toBe(false);
    expect(demoQuota("a")).toEqual({ used: 2, limit: 2, left: 0 });
    expect(takeDemoQuestion("b")).toBe(true);
  });

  it("the signed-in owner uses their own keys with no demo rules", async () => {
    vi.stubEnv("PUBLIC_DEMO_MODE", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "owner-key");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-demo");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("SYNTHESIZER_MODEL", "claude-sonnet-5");
    const { hasProviderKey, modelFor } = await import("@/providers/llm/registry");
    const { asOwner, demoFor, forUser, isDemo, withoutLlm } = await import("@/providers/llm/demo");
    const { OWNER_USER_ID } = await import("@/lib/owner-auth");
    expect(demoFor(OWNER_USER_ID)).toBe(false);
    expect(demoFor("visitor-1")).toBe(true);
    await forUser(OWNER_USER_ID, async () => {
      expect(isDemo()).toBe(false);
      expect(hasProviderKey("anthropic")).toBe(true);
      expect((await modelFor("synthesizer")).config).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
    });
    // visitors, and everything outside the owner's request, stay on the free model
    await forUser("visitor-1", async () => expect((await modelFor("synthesizer")).config.provider).toBe("openrouter"));
    expect(hasProviderKey("anthropic")).toBe(false);
    // withoutLlm inside the owner scope keeps the owner flag
    await asOwner(() => withoutLlm(async () => expect(isDemo()).toBe(false)));
  });

  it("self-hosted installs keep using their own env keys", async () => {
    vi.stubEnv("PUBLIC_DEMO_MODE", "false");
    vi.stubEnv("ANTHROPIC_API_KEY", "my-key");
    const { hasProviderKey, llmAvailable } = await import("@/providers/llm/registry");
    expect(hasProviderKey("anthropic")).toBe(true);
    expect(llmAvailable()).toBe(true);
  });
});
