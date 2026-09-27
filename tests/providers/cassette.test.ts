import { mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CassetteMissError, cassetteKey, cassetteStats, recordingModel, replayModel, resetCassetteStats } from "@/providers/llm/cassette";

const dir = mkdtempSync(path.join(os.tmpdir(), "cassettes-"));
let calls = 0;
const fake: LanguageModelV4 = {
  specificationVersion: "v4",
  provider: "fake",
  modelId: "fake-1",
  supportedUrls: {},
  async doGenerate() {
    calls++;
    return {
      content: [{ type: "text", text: "hello" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } },
      warnings: [],
    };
  },
  async doStream() {
    throw new Error("not used");
  },
};

describe("LLM cassettes (record / replay)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("records a live call and replays it without touching the model, ignoring timestamps", async () => {
    vi.stubEnv("LLM_CASSETTE_DIR", dir);
    const prompt = "PORTFOLIO (as of 2026-09-27T10:00:00.000Z): {}\n질문";
    const rec = await generateText({ model: recordingModel(fake, "fake-1"), prompt });
    expect(rec.text).toBe("hello");
    expect(calls).toBe(1);
    expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toHaveLength(1);

    resetCassetteStats();
    const rep = await generateText({ model: replayModel("fake", "fake-1"), prompt: prompt.replace("2026-09-27T10:00:00.000Z", "2027-01-01T00:00:00.000Z") });
    expect(rep.text).toBe("hello");
    expect(rep.usage.inputTokens).toBe(10);
    expect(calls).toBe(1);
    expect(cassetteStats).toMatchObject({ hits: 1, misses: [] });
  });

  it("misses loudly on an unseen prompt and counts the miss", async () => {
    vi.stubEnv("LLM_CASSETTE_DIR", dir);
    resetCassetteStats();
    await expect(generateText({ model: replayModel("fake", "fake-1"), prompt: "다른 질문" })).rejects.toBeInstanceOf(CassetteMissError);
    expect(cassetteStats.misses).toHaveLength(1);
  });

  it("keys on model id, prompt, tools and response format", () => {
    const base = { prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "x" }] }] };
    expect(cassetteKey("a", base)).toBe(cassetteKey("a", base));
    expect(cassetteKey("a", base)).not.toBe(cassetteKey("b", base));
    expect(cassetteKey("a", { ...base, responseFormat: { type: "json" } })).not.toBe(cassetteKey("a", base));
  });
});
