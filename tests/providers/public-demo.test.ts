import { afterEach, describe, expect, it, vi } from "vitest";

describe("public demo Toss isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses live Toss credentials even when live mode is enabled", async () => {
    vi.stubEnv("PUBLIC_DEMO_MODE", "true");
    vi.stubEnv("ENABLE_REAL_TOSS", "true");
    vi.stubEnv("TOSS_CLIENT_ID", "test-client");
    vi.stubEnv("TOSS_CLIENT_SECRET", "test-secret");

    const { liveTossTransport } = await import("@/providers/finance/toss-api");
    expect(liveTossTransport()).toBeNull();
  });
});
