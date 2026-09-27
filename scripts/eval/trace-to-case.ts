/**
 * Turns a persisted agent run (trace) into an eval case draft for labeling.
 *
 *   npm run eval:case -- <runId>            # from data/app.db by default
 *   npm run eval:case -- --latest [--db file:./data/eval.db] [--out tests/evals/cases/drafts]
 *
 * The draft carries the routing decision as `expect` (edit it if the run was wrong), the produced answer as
 * `actual` for the labeler to read, and an empty `labels` array. It is not a test until a human reviews it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
process.env.DATABASE_URL = opt("db") ?? process.env.DATABASE_URL ?? "file:./data/app.db";
const outDir = opt("out") ?? "tests/evals/cases/drafts";
const runIdArg = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--db" && argv[argv.indexOf(a) - 1] !== "--out");

async function main() {
  const { desc, eq } = await import("drizzle-orm");
  const { getDb, schema } = await import("@/db");
  const { buildPlan } = await import("@/orchestration/graph");
  const { RoutingDecision, AgentAnswer } = await import("@/domain/agent");
  const db = await getDb();

  const run = runIdArg
    ? (await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runIdArg)))[0]
    : argv.includes("--latest")
      ? (await db.select().from(schema.agentRuns).orderBy(desc(schema.agentRuns.startedAt)).limit(1))[0]
      : undefined;
  if (!run) {
    console.error("usage: trace-to-case <runId> | --latest  [--db <url>] [--out <dir>]");
    process.exit(2);
  }
  const steps = await db.select().from(schema.agentSteps).where(eq(schema.agentSteps.runId, run.id));
  const tools = await db.select().from(schema.toolCalls).where(eq(schema.toolCalls.runId, run.id));
  const routing = run.routing ? RoutingDecision.safeParse(JSON.parse(run.routing)) : undefined;
  const answer = run.answer ? AgentAnswer.safeParse(JSON.parse(run.answer)) : undefined;

  const draft = {
    id: `draft-${run.id.slice(0, 8)}`,
    suite: "capability",
    profile: run.userId.startsWith("eval:") ? run.userId.slice(5) : "demo",
    turns: [{ role: "user", content: run.userMessage }],
    expect: routing?.success
      ? { plan: buildPlan(routing.data), prediction: routing.data.isPredictionRequest, scenario: routing.data.scenario?.kind ?? "", trade: routing.data.trade, assertions: [] as string[], judge: [] as string[], mustMention: [] as string[], mustNotMatch: [] as string[] }
      : { assertions: [], judge: [], mustMention: [], mustNotMatch: [] },
    reference: "",
    source: `trace:${run.id}`,
    labels: [] as unknown[],
    actual: {
      startedAt: run.startedAt,
      error: run.error,
      routing: routing?.success ? { decidedBy: routing.data.decidedBy, confidence: routing.data.confidence, symbols: routing.data.symbols } : undefined,
      summary: answer?.success ? answer.data.summary : undefined,
      recommendation: answer?.success ? answer.data.recommendation : undefined,
      policyChecks: answer?.success ? answer.data.policyChecks.map((c) => `${c.rule}${c.subject ? `:${c.subject}` : ""}=${c.status}`) : [],
      risks: answer?.success ? answer.data.risks.map((r) => r.title) : [],
      limitations: answer?.success ? answer.data.limitations : [],
      steps: steps.map((s) => `${s.name}:${s.status}${s.latencyMs != null ? `:${s.latencyMs}ms` : ""}`),
      toolCalls: tools.map((t) => `${t.tool}:${t.status}`),
      llmCalls: run.llmCalls,
      latencyMs: run.latencyMs,
      estimatedCost: run.estimatedCost,
    },
  };
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${draft.id}.json`);
  writeFileSync(file, JSON.stringify(draft, null, 2));
  console.log(file);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
