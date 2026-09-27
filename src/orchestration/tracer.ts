import { randomUUID } from "node:crypto";
import type { Tool, ToolSet } from "ai";
import { getDb, schema } from "@/db";
import type { AgentAnswer, AgentStreamEvent, RoutingDecision } from "@/domain/agent";
import { flag } from "@/lib/env";
import { estimateCost } from "@/providers/llm/pricing";

export type StepKind = "decision" | "llm" | "deterministic" | "skipped";
export interface StepRecord {
  id: string;
  name: string;
  kind: StepKind;
  provider?: string;
  model?: string;
  status: "ok" | "error" | "skipped";
  startedAt: string;
  finishedAt?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  parallelGroup?: string;
  input?: unknown;
  output?: unknown;
}
export interface ToolCallRecord {
  id: string;
  stepId?: string;
  tool: string;
  input: unknown;
  output: unknown;
  /** untruncated result, in memory only (graders need every number the model saw); never persisted */
  rawOutput?: unknown;
  latencyMs: number;
  status: "ok" | "error";
  createdAt: string;
}
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Records every decision / LLM / deterministic step and tool call of one run; persists when ENABLE_AGENT_TRACE. */
export class Tracer {
  readonly runId = randomUUID();
  readonly startedAt = new Date().toISOString();
  readonly steps: StepRecord[] = [];
  readonly toolCalls: ToolCallRecord[] = [];
  cost = 0;

  constructor(
    readonly userMessage: string,
    private emit: (e: AgentStreamEvent) => void = () => {},
    readonly userId = "demo",
  ) {}

  event(e: AgentStreamEvent) {
    this.emit(e);
  }

  async step<T>(
    name: string,
    kind: StepKind,
    fn: (rec: StepRecord) => Promise<T>,
    opts: { provider?: string; model?: string; parallelGroup?: string; input?: unknown } = {},
  ): Promise<T> {
    const rec: StepRecord = { id: randomUUID(), name, kind, status: "ok", startedAt: new Date().toISOString(), ...opts };
    this.steps.push(rec);
    this.emit({ type: "step", name, status: "started", kind, parallelGroup: opts.parallelGroup });
    const t0 = Date.now();
    try {
      const out = await fn(rec);
      rec.output ??= summarize(out);
      return out;
    } catch (e) {
      rec.status = "error";
      rec.output = { error: (e as Error).message };
      this.emit({ type: "step", name, status: "error", detail: (e as Error).message, kind, provider: rec.provider, model: rec.model, parallelGroup: rec.parallelGroup });
      throw e;
    } finally {
      rec.finishedAt = new Date().toISOString();
      rec.latencyMs = Date.now() - t0;
      if (rec.status === "ok") this.emit({ type: "step", name, status: "ok", detail: rec.latencyMs + "ms", kind, provider: rec.provider, model: rec.model, latencyMs: rec.latencyMs, parallelGroup: rec.parallelGroup });
    }
  }

  skip(name: string, reason: string) {
    this.steps.push({ id: randomUUID(), name, kind: "skipped", status: "skipped", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), latencyMs: 0, output: { reason } });
    this.emit({ type: "step", name, status: "skipped", detail: reason, kind: "skipped" });
  }

  usage(rec: StepRecord, usage: Usage | undefined, model?: string) {
    rec.inputTokens = (rec.inputTokens ?? 0) + (usage?.inputTokens ?? 0);
    rec.outputTokens = (rec.outputTokens ?? 0) + (usage?.outputTokens ?? 0);
    this.cost += estimateCost(model ?? rec.model, usage) ?? 0;
  }

  /** Wraps AI SDK tools so every execution is timed and recorded under the given step. */
  traceTools<T extends ToolSet>(tools: T, stepId: string): T {
    const out: ToolSet = {};
    for (const [name, t] of Object.entries(tools)) {
      const original = t as Tool & { execute?: (input: unknown, options: unknown) => Promise<unknown> };
      out[name] = {
        ...original,
        execute: async (input: unknown, options: unknown) => {
          const t0 = Date.now();
          const rec: ToolCallRecord = { id: randomUUID(), stepId, tool: name, input, output: undefined, latencyMs: 0, status: "ok", createdAt: new Date().toISOString() };
          this.toolCalls.push(rec);
          try {
            const result = await original.execute!(input, options);
            rec.output = summarize(result);
            rec.rawOutput = result;
            if (result && typeof result === "object" && "error" in result) rec.status = "error";
            return result;
          } catch (e) {
            rec.status = "error";
            rec.output = { error: (e as Error).message };
            throw e;
          } finally {
            rec.latencyMs = Date.now() - t0;
          }
        },
      } as Tool;
    }
    return out as T;
  }

  summary() {
    const llm = this.steps.filter((s) => s.kind === "llm" && s.status !== "skipped");
    return {
      llmCalls: llm.length,
      decisionCalls: this.steps.filter((s) => s.kind === "decision" && s.status !== "skipped").length,
      toolCalls: this.toolCalls.length,
      inputTokens: this.steps.reduce((s, x) => s + (x.inputTokens ?? 0), 0),
      outputTokens: this.steps.reduce((s, x) => s + (x.outputTokens ?? 0), 0),
      agentsAvoided: this.steps.filter((s) => s.kind === "skipped").length,
      estimatedCost: Math.round(this.cost * 1e6) / 1e6,
      latencyMs: Date.now() - Date.parse(this.startedAt),
    };
  }

  async persist(result: { answer?: AgentAnswer; routing?: RoutingDecision; error?: string }) {
    if (!flag("ENABLE_AGENT_TRACE", true)) return;
    const db = await getDb();
    const s = this.summary();
    await db.insert(schema.agentRuns).values({
      id: this.runId,
      userId: this.userId,
      userMessage: this.userMessage,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      llmCalls: s.llmCalls,
      decisionCalls: s.decisionCalls,
      toolCalls: s.toolCalls,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      latencyMs: s.latencyMs,
      estimatedCost: s.estimatedCost,
      routing: result.routing ? JSON.stringify(result.routing) : null,
      answer: result.answer ? JSON.stringify(result.answer) : null,
      error: result.error ?? null,
    });
    if (this.steps.length) {
      await db.insert(schema.agentSteps).values(
        this.steps.map((st) => ({
          id: st.id,
          runId: this.runId,
          name: st.name,
          kind: st.kind,
          provider: st.provider ?? null,
          model: st.model ?? null,
          status: st.status,
          startedAt: st.startedAt,
          finishedAt: st.finishedAt ?? null,
          latencyMs: st.latencyMs ?? null,
          inputTokens: st.inputTokens ?? null,
          outputTokens: st.outputTokens ?? null,
          parallelGroup: st.parallelGroup ?? null,
          input: st.input === undefined ? null : JSON.stringify(st.input),
          output: st.output === undefined ? null : JSON.stringify(st.output),
        })),
      );
    }
    if (this.toolCalls.length) {
      await db.insert(schema.toolCalls).values(
        this.toolCalls.map((t) => ({
          id: t.id,
          runId: this.runId,
          stepId: t.stepId ?? null,
          tool: t.tool,
          input: JSON.stringify(t.input ?? null),
          output: JSON.stringify(t.output ?? null),
          latencyMs: t.latencyMs,
          status: t.status,
          createdAt: t.createdAt,
        })),
      );
    }
  }
}

/** Keeps trace payloads small: strings capped, arrays truncated. */
function summarize(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return v.length > 600 ? v.slice(0, 600) + "…" : v;
  if (typeof v !== "object") return v;
  if (depth > 4) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => summarize(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, summarize(x, depth + 1)]));
}
