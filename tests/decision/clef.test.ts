import { afterEach, describe, expect, it, vi } from "vitest";
import { ClefDecisionModel } from "@/decision/clef";
import { decisionModel, DecisionUnavailableError } from "@/decision";
import { route } from "@/orchestration/router";
import { Tracer } from "@/orchestration/tracer";

type Q = { type: string; instructions?: string; criteria?: unknown };

/** Mirrors the request validation and answer shapes of Clef's systemone() (joint_schema_model.py); every option gets p = 1/n except the first. */
function fakeClef(calls: { url: string; body: { model: string; state: unknown; questions: Record<string, Q> }; headers: Record<string, string> }[]) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    if (typeof body.model !== "string" || !("state" in body)) return new Response("model and state are required", { status: 400 });
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries<Q>(body.questions)) {
      if (q.type !== "noul" && !q.criteria) return new Response(`${id}: criteria must not be empty`, { status: 400 });
      if (q.type === "noul") answers[id] = { type: "noul", noul: 0.9 };
      if (q.type === "choice") {
        const opts = Object.entries(q.criteria as Record<string, string>);
        if (opts.some(([, d]) => typeof d !== "string")) return new Response("description must be a string", { status: 400 });
        const probabilities = Object.fromEntries(opts.map(([k], i) => [k, i === 0 ? 0.7 : 0.3 / (opts.length - 1)]));
        answers[id] = { type: "choice", choice: opts[0][0], confidence: 0.7, probabilities };
      }
      if (q.type === "score") {
        const levels = (q.criteria as string[]).map((_, i) => String(i));
        answers[id] = { type: "score", score: 1.6, confidence: 0.6, legend: Object.fromEntries(levels.map((l, i) => [l, (q.criteria as string[])[i]])), probabilities: Object.fromEntries(levels.map((l) => [l, 1 / levels.length])) };
      }
    }
    return Response.json({ model: body.model, answers, usage: { input_tokens: 42, output_tokens: 0 } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Clef decision model", () => {
  it("sends SystemOne requests to <base>/v1/systemone and reads noul probabilities", async () => {
    const calls: Parameters<typeof fakeClef>[0] = [];
    vi.stubGlobal("fetch", fakeClef(calls));
    const m = new ClefDecisionModel("http://gpu:30000/", undefined, "Cloudflare/clef");
    const r = await m.evaluateMany({ held: ["NVDA"] }, { a: "Is NVDA held?", b: { question: "Is it urgent?", true: "asks for action now" } });
    expect(r.probabilities).toEqual({ a: 0.9, b: 0.9 });
    expect(r.meta).toMatchObject({ model: "clef/Cloudflare/clef", inputTokens: 42, outputTokens: 0 });
    expect(calls[0].url).toBe("http://gpu:30000/v1/systemone");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body.questions.b).toEqual({ type: "noul", instructions: "Is it urgent?", criteria: { true: "asks for action now" } });
  });

  it("describes choice options that have no description by their id, and sends the bearer key when set", async () => {
    const calls: Parameters<typeof fakeClef>[0] = [];
    vi.stubGlobal("fetch", fakeClef(calls));
    const m = new ClefDecisionModel("http://gpu:30000", "k1");
    const r = await m.choice({}, ["buy", "hold", "sell"] as const, "What does the user want?");
    expect(r).toMatchObject({ choice: "buy", confidence: 0.7 });
    expect(calls[0].body.questions.q.criteria).toEqual({ buy: "buy", hold: "hold", sell: "sell" });
    expect(calls[0].headers.Authorization).toBe("Bearer k1");
  });

  it("rounds Clef's expected score to a level index", async () => {
    vi.stubGlobal("fetch", fakeClef([]));
    const r = await new ClefDecisionModel("http://gpu:30000").score({}, { question: "How risky?", levels: ["low", "mid", "high"] });
    expect(r.score).toBe(2);
    expect(r.confidence).toBe(0.6);
  });

  it("turns HTTP and network failures into DecisionUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));
    await expect(new ClefDecisionModel("http://gpu:30000").evaluate({}, "x")).rejects.toThrow(DecisionUnavailableError);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(new ClefDecisionModel("http://gpu:30000").evaluate({}, "x")).rejects.toThrow("clef: network error");
  });

  it("is selected when CLEF_BASE_URL is set and drives the router", async () => {
    vi.stubEnv("CLEF_BASE_URL", "http://gpu:30000");
    vi.stubEnv("DECISION_PROVIDER", "clef");
    vi.stubGlobal("fetch", fakeClef([]));
    const dm = decisionModel();
    expect(dm?.name).toBe("clef");
    const r = await route({ message: "엔비디아 팔까?", hasPortfolio: true, hasPolicy: true, heldSymbols: ["NVDA"] }, dm, new Tracer("t"));
    expect(r.decidedBy).toBe("clef");
    expect(r.escalated).toBe(false);
  });
});
