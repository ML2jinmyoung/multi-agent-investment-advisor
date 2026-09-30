/**
 * Eval runner: executes labeled cases through the real agent pipeline and writes a report.
 *
 *   npm run eval -- --mode replay            # cassettes, no network, no keys (CI)
 *   npm run eval -- --mode record            # live models, writes cassettes + manifest
 *   npm run eval -- --mode live --trials 3   # live models, no recording
 *   npm run eval -- --mode rules             # no LLM at all: deterministic template path
 *
 * Options: --suite regression|capability|all|holdout|golden (default golden) or --cases <file|dir>
 *          --profile <name|demo> (overrides each case's profile) --trials <k> --filter <text> --limit <n>
 *          --ids a,b,c (exact case ids) --no-judge (skip the LLM judge) --variant full|single-agent|no-critic
 *          --out <dir> (default evals/reports)
 * Exit code 1 when a regression/golden trial fails (status not ok, or a code grader / must-mention rule fails).
 *
 * Environment is pinned before any app module loads: eval DB, fixture market data, external evidence off,
 * LLM-based decision model (Jev needs a local server and would make runs environment-dependent).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EvalCase } from "@/evals/cases";
import type { Grade } from "./graders/code";
import type { GroupGrade, GroupMember } from "./graders/groups";
import type { JudgeVerdict } from "./graders/judge";

type Mode = "replay" | "record" | "live" | "rules";
const MODES: Mode[] = ["replay", "record", "live", "rules"];

const args = parseArgs(process.argv.slice(2));
const mode = (args.mode ?? "replay") as Mode;
if (!MODES.includes(mode)) fail(`--mode must be one of ${MODES.join(", ")}`);
const profileOverride = args.profile;
const suite = args.cases ? undefined : (args.suite ?? "golden");
const casesPath = args.cases ?? (suite === "golden" ? "tests/evals/golden.json" : `suite:${suite}`);
const trials = Math.max(1, Number(args.trials ?? 1));
const useJudge = args["no-judge"] === undefined;
const variant = args.variant ?? "full";
if (!["full", "single-agent", "no-critic"].includes(variant)) fail("--variant must be full, single-agent or no-critic");
process.env.AGENT_VARIANT = variant;
const BUDGETS = { latencyMs: Number(process.env.EVAL_LATENCY_BUDGET_MS ?? 60_000), costUSD: Number(process.env.EVAL_COST_BUDGET_USD ?? 0.25) };
const outDir = args.out ?? "evals/reports";

// ---- environment (before importing anything from src) ----
const CASSETTE_DIR = process.env.LLM_CASSETTE_DIR || "tests/evals/cassettes";
const MANIFEST = path.join(CASSETTE_DIR, "manifest.json");
const AGENT_ENV: Record<string, string> = { orchestratorFallback: "ORCHESTRATOR_MODEL", portfolio: "PORTFOLIO_MODEL", evidence: "EVIDENCE_MODEL", critic: "CRITIC_MODEL", synthesizer: "SYNTHESIZER_MODEL" };

if ((mode === "record" || mode === "live") && existsSync(".env.local")) process.loadEnvFile(".env.local");
Object.assign(process.env, {
  DATABASE_URL: process.env.EVAL_DATABASE_URL || "file:./data/eval.db",
  ENABLE_AGENT_TRACE: "true",
  ENABLE_REAL_TOSS: "false",
  MARKET_DATA_PROVIDER: "",
  ENABLE_EXTERNAL_EVIDENCE: "false",
  PUBLIC_DEMO_MODE: "false",
  DECISION_PROVIDER: "llm",
  LLM_CASSETTE_MODE: mode === "record" || mode === "replay" ? mode : "off",
  LLM_CASSETTE_DIR: CASSETTE_DIR,
});
delete process.env.TYPESAFE_API_KEY;
if (mode === "rules") for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]) delete process.env[k];
if (mode === "replay") {
  if (!existsSync(MANIFEST)) fail(`no cassette manifest at ${MANIFEST}; run with --mode record first`);
  const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  process.env.LLM_PROVIDER = m.provider;
  for (const [agent, cfg] of Object.entries(m.models)) process.env[AGENT_ENV[agent]] = cfg.model;
  // Prompts carry the calendar date (evidence freshness, "today"), so replaying on a later day misses every
  // cassette. Replay runs on the recording day's clock; time still advances, so latencies stay real.
  const offset = Date.parse(m.recordedAt) - Date.now();
  const RealDate = Date;
  class RecordingDayDate extends RealDate {
    constructor(...args: [] | [string | number | Date]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(args[0]);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = RecordingDayDate as DateConstructor;
}

// ---- types ----
interface Manifest {
  recordedAt: string;
  provider: string;
  models: Record<string, { provider: string; model: string }>;
  cases: string;
  profile: string;
}
interface TrialResult {
  caseId: string;
  profile: string;
  query: string;
  trial: number;
  status: "ok" | "cassette_miss" | "llm_fallback" | "error";
  error?: string;
  runId?: string;
  /** no required node missing, trade/scenario/prediction/violation as labeled (gate) */
  planMatch?: boolean;
  /** every labeled field identical, including nodes the LLM router added (report only) */
  planExact?: boolean;
  planOver?: number;
  planDiff: string[];
  decidedBy?: string;
  needsCritic?: boolean;
  steps: string[];
  llmCalls: number;
  decisionCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCost: number;
  summary?: string;
  recommendation?: string;
  grades: Grade[];
  judge: JudgeVerdict[];
  judgeModel?: string;
  /** status ok and every code grader / text rule passed; judge verdicts are reported, not gated */
  pass: boolean;
}

async function main() {
  const { runAgent } = await import("@/orchestration/orchestrator");
  const { buildPlan } = await import("@/orchestration/graph");
  const { installProfile, listProfiles } = await import("@/evals/profiles");
  const { goldenToCases, loadCases: loadCaseFiles, loadSuite } = await import("@/evals/cases");
  const { gradeCode } = await import("./graders/code");
  const { gradeGroups } = await import("./graders/groups");
  const { judge } = await import("./graders/judge");
  const { cassetteStats, resetCassetteStats } = await import("@/providers/llm/cassette");
  const { modelFor, AGENT_NAMES, llmAvailable } = await import("@/providers/llm/registry");

  if (profileOverride && !listProfiles().includes(profileOverride)) fail(`unknown profile ${profileOverride}; available: ${listProfiles().join(", ")}`);
  if (mode !== "rules" && !llmAvailable()) fail("no LLM provider configured; use --mode rules or add keys to .env.local");

  let cases: EvalCase[] = args.cases
    ? args.cases.endsWith("golden.json") ? goldenToCases(args.cases) : loadCaseFiles(args.cases)
    : suite === "golden" ? goldenToCases("tests/evals/golden.json")
      : loadSuite(suite as "regression" | "capability" | "all" | "holdout");
  if (args.filter) cases = cases.filter((c) => c.id.includes(args.filter!) || c.turns.some((t) => t.content.includes(args.filter!)));
  if (args.ids) {
    const ids = new Set(args.ids.split(",").map((s) => s.trim()).filter(Boolean));
    cases = cases.filter((c) => ids.has(c.id));
  }
  if (args.limit) cases = cases.slice(0, Number(args.limit));
  if (!cases.length) fail("no cases selected");

  const models: Manifest["models"] = {};
  if (mode !== "rules") for (const a of AGENT_NAMES) models[a] = (await modelFor(a)).config;

  const profiles = [...new Set(cases.map((c) => profileOverride ?? c.profile))];
  for (const p of profiles) if (!listProfiles().includes(p)) fail(`unknown profile ${p}; available: ${listProfiles().join(", ")}`);
  const userIds = new Map<string, string>();
  for (const p of profiles) userIds.set(p, await installProfile(p));
  const profileName = profileOverride ?? (profiles.length === 1 ? profiles[0] : "per-case");
  const startedAt = new Date();
  const results: TrialResult[] = [];
  const groupMembers: GroupMember[] = [];
  console.log(`eval · mode=${mode} · variant=${variant} · profiles=${profiles.join(",")} · cases=${cases.length} · trials=${trials}`);

  for (const c of cases) {
    const userId = userIds.get(profileOverride ?? c.profile)!;
    for (let trial = 1; trial <= trials; trial++) {
      resetCassetteStats();
      const steps: string[] = [];
      let decidedBy: string | undefined;
      let needsCritic: boolean | undefined;
      const history: { role: "user" | "assistant"; content: string }[] = [];
      const r: TrialResult = { caseId: c.id, profile: profileOverride ?? c.profile, query: c.turns.filter((t) => t.role === "user").at(-1)?.content ?? "", trial, status: "ok", planDiff: [], steps, llmCalls: 0, decisionCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, estimatedCost: 0, grades: [], judge: [], pass: false };
      const t0 = Date.now();
      let lastRun: Awaited<ReturnType<typeof runAgent>> | undefined;
      let previousRun: Awaited<ReturnType<typeof runAgent>> | undefined;
      try {
        for (const turn of c.turns) {
          if (turn.role === "assistant") {
            history.push(turn);
            continue;
          }
          const run = await runAgent(
            turn.content,
            (e) => {
              if (e.type === "step") steps.push(`${e.name}:${e.status}`);
              if (e.type === "verification") {
                decidedBy = e.verification.decidedBy;
                needsCritic = e.verification.needsCritic;
              }
            },
            { userId, history: [...history] },
          );
          history.push({ role: "user", content: turn.content }, { role: "assistant", content: `${run.answer.summary} ${run.answer.recommendation}` });
          previousRun = lastRun;
          lastRun = run;
          // the last user turn is the graded one
          const actual: Record<string, boolean | string> = { ...buildPlan(run.routing), prediction: run.routing.isPredictionRequest, scenario: run.routing.scenario?.kind ?? "" };
          const expected: Record<string, boolean | string> = { ...(c.expect.plan ?? {}) };
          if (c.expect.prediction !== undefined) expected.prediction = c.expect.prediction;
          if (c.expect.scenario !== undefined) expected.scenario = c.expect.scenario;
          // Over-inclusion (an extra specialist ran) is a cost issue (R12); omission of a required node is a correctness miss.
          // In rules mode the plan is deterministic and must match exactly; with an LLM router only misses fail the gate.
          const OVER_OK = new Set(["evidence", "policy", "riskReview"]);
          r.planDiff = Object.entries(expected)
            .filter(([k, v]) => actual[k] !== v)
            .map(([k, v]) => {
              const over = mode !== "rules" && ((OVER_OK.has(k) && v === false && actual[k] === true) || (k === "simple" && v === true && actual[k] === false));
              return `${over ? "over" : "miss"} ${k}: expected ${v}, got ${actual[k]}`;
            });
          r.planExact = r.planDiff.length === 0;
          r.planDiff = r.planDiff.filter((d) => !d.startsWith("over "));
          r.planOver = Object.entries(expected).filter(([k, v]) => actual[k] !== v).length - r.planDiff.length;
          if (c.expect.trade) {
            const t = run.routing.trade;
            for (const k of ["symbol", "action", "amountKRW", "quantity"] as const) if (c.expect.trade[k] !== undefined && t?.[k] !== c.expect.trade[k]) r.planDiff.push(`trade.${k}: expected ${c.expect.trade[k]}, got ${t?.[k]}`);
          }
          if (c.expect.trade === null && run.routing.trade) r.planDiff.push(`trade: expected none, got ${run.routing.trade.symbol} ${run.routing.trade.action}`);
          if (c.expect.policyViolation !== undefined) {
            const violated = run.answer.policyChecks.some((p) => p.status === "violation");
            if (violated !== c.expect.policyViolation) r.planDiff.push(`policyViolation: expected ${c.expect.policyViolation}, got ${violated}`);
          }
          if (c.expect.errorMatch) r.planDiff.push(`expected an error matching /${c.expect.errorMatch}/ but the run completed`);
          r.planMatch = r.planDiff.length === 0;
          r.runId = run.runId;
          r.llmCalls += run.summary.llmCalls;
          r.decisionCalls += run.summary.decisionCalls;
          r.toolCalls += run.summary.toolCalls;
          r.inputTokens += run.summary.inputTokens;
          r.outputTokens += run.summary.outputTokens;
          r.estimatedCost += run.summary.estimatedCost;
          r.summary = run.answer.summary;
          r.recommendation = run.answer.recommendation;
          if (run.answer.limitations.some((l) => l.startsWith("LLM 호출 실패"))) r.status = "llm_fallback";
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (c.expect.errorMatch && new RegExp(c.expect.errorMatch).test(msg)) {
          r.planMatch = true;
          r.summary = `(expected error) ${msg}`;
        } else {
          r.status = "error";
          r.error = msg;
        }
      }
      r.latencyMs = Date.now() - t0;
      r.decidedBy = decidedBy;
      r.needsCritic = needsCritic;
      if (lastRun && r.status !== "error") {
        if (c.invariantOf || c.contrastOf) groupMembers.push({ caseId: c.id, trial, run: lastRun });
        r.grades = gradeCode({ c, run: lastRun, previous: previousRun, planDiff: r.planDiff, latencyMs: r.latencyMs, budgets: mode === "live" || mode === "record" ? BUDGETS : undefined });
        if (useJudge && mode !== "rules" && c.expect.judge.length) {
          try {
            const j = await judge(c, lastRun);
            r.judge = j.verdicts;
            r.judgeModel = j.model;
          } catch (e) {
            r.judge = c.expect.judge.map((k) => ({ rubric: k, pass: true, quote: "", reason: `judge unavailable: ${(e as Error).message.slice(0, 80)}` }));
          }
        }
      }
      if (mode === "replay" && cassetteStats.misses.length) {
        r.status = "cassette_miss";
        r.error = `${cassetteStats.misses.length} miss(es): ${cassetteStats.misses.slice(0, 3).join(", ")}`;
      }
      r.pass = r.status === "ok" && r.grades.every((g) => g.pass);
      results.push(r);
      const failed = r.grades.filter((g) => !g.pass).map((g) => g.rubric);
      const judgeFailed = r.judge.filter((v) => !v.pass).map((v) => `judge:${v.rubric}`);
      const mark = r.status !== "ok" ? `!${r.status}` : r.pass ? "✓" : `✗ ${failed.join(",")}`;
      console.log(`${mark.slice(0, 44).padEnd(44)} ${c.id.padEnd(28)} ${r.latencyMs.toString().padStart(6)}ms llm=${r.llmCalls} tools=${r.toolCalls} $${r.estimatedCost.toFixed(3)}${judgeFailed.length ? `  ${judgeFailed.join(",")}` : ""}`);
    }
  }

  if (mode === "record") {
    mkdirSync(CASSETTE_DIR, { recursive: true });
    const manifest: Manifest = { recordedAt: startedAt.toISOString(), provider: process.env.LLM_PROVIDER ?? "anthropic", models, cases: casesPath, profile: profileName };
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  }

  const groups = gradeGroups(cases, groupMembers);
  const report = buildReport({ mode, variant, profileName, casesPath, trials, models, startedAt, results, groups });
  mkdirSync(outDir, { recursive: true });
  const stamp = localStamp(startedAt);
  const base = path.join(outDir, `${stamp}-${mode}${variant === "full" ? "" : `-${variant}`}-${profileName}`);
  writeFileSync(`${base}.json`, JSON.stringify({ ...report.meta, results }, null, 2));
  writeFileSync(`${base}.md`, report.markdown);
  writeFileSync(path.join(outDir, `latest-${mode}${variant === "full" ? "" : `-${variant}`}.md`), report.markdown);
  console.log(`\n${report.summaryLine}\nreport: ${base}.md`);
  // rules mode is the no-LLM baseline, never a gate; regression/golden gate in replay/record/live
  const gated = (suite === "regression" || suite === "golden") && mode !== "rules";
  if (results.some((r) => r.status === "cassette_miss" || r.status === "error") || (gated && (results.some((r) => !r.pass) || groups.some((g) => !g.pass)))) process.exitCode = 1;
}

// ---- report ----
/** Which part of the answer a rubric grades, and whether that part has a ground truth (plan §1 / "쪼개서 평가"). */
const PARTS: { part: string; truth: string; rubrics: string[] }[] = [
  { part: "실행 계획·거래 해석", truth: "라벨(정답 있음)", rubrics: ["routing_plan_match"] },
  { part: "숫자", truth: "결정론 엔진 입력(정답 있음)", rubrics: ["numeric_grounding"] },
  { part: "정책 판정·문구 일관성", truth: "정책 엔진(정답 있음) + 문구 성질", rubrics: ["policy_consistency"] },
  { part: "한계 고지", truth: "데이터 경고(정답 있음)", rubrics: ["limitation_honesty"] },
  { part: "구조: 위험·비용·대안", truth: "성질 검사", rubrics: ["risk_and_cost_disclosure", "alternatives_quality"] },
  { part: "산문 성질: 예측·인젝션·문구", truth: "성질 검사", rubrics: ["no_prediction_as_fact", "injection_resistance", "must_mention", "must_not_match"] },
  { part: "문맥·도구 사용", truth: "실행 trace", rubrics: ["context_carryover", "tool_use_appropriateness"] },
  { part: "지연·비용", truth: "예산", rubrics: ["latency_cost_budget"] },
];

function buildReport(input: { mode: Mode; variant: string; profileName: string; casesPath: string; trials: number; models: Manifest["models"]; startedAt: Date; results: TrialResult[]; groups: GroupGrade[] }) {
  const { results, groups } = input;
  const ok = results.filter((r) => r.status === "ok");
  const planMatched = results.filter((r) => r.planMatch).length;
  const planExact = results.filter((r) => r.planExact).length;
  const overIncluded = results.reduce((s, r) => s + (r.planOver ?? 0), 0);
  const passed = results.filter((r) => r.pass).length;
  const rubricStats = new Map<string, { pass: number; total: number }>();
  for (const r of results) for (const g of r.grades) {
    const s = rubricStats.get(g.rubric) ?? { pass: 0, total: 0 };
    s.total++;
    if (g.pass) s.pass++;
    rubricStats.set(g.rubric, s);
  }
  const judgeStats = new Map<string, { pass: number; total: number }>();
  for (const r of results) for (const v of r.judge) {
    const s = judgeStats.get(v.rubric) ?? { pass: 0, total: 0 };
    s.total++;
    if (v.pass) s.pass++;
    judgeStats.set(v.rubric, s);
  }
  const casesAllPassed = [...new Set(results.map((r) => r.caseId))].filter((id) => results.filter((r) => r.caseId === id).every((r) => r.pass)).length;
  const byCase = new Map<string, TrialResult[]>();
  for (const r of results) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);
  // pass^k on plan match: every trial of the case matched
  const casesAllMatched = [...byCase.values()].filter((rs) => rs.every((r) => r.status === "ok" && r.planMatch)).length;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ?? 0;
  const sum = (f: (r: TrialResult) => number) => results.reduce((s, r) => s + f(r), 0);
  const partRows = PARTS.map((p) => {
    const gs = results.flatMap((r) => r.grades.filter((g) => p.rubrics.includes(g.rubric)));
    return { ...p, pass: gs.filter((g) => g.pass).length, total: gs.length };
  });
  const meta = {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    variant: input.variant,
    profile: input.profileName,
    cases: input.casesPath,
    trials: input.trials,
    models: input.models,
    totals: {
      trials: results.length,
      cases: byCase.size,
      ok: ok.length,
      cassetteMiss: results.filter((r) => r.status === "cassette_miss").length,
      llmFallback: results.filter((r) => r.status === "llm_fallback").length,
      error: results.filter((r) => r.status === "error").length,
      pass: passed,
      passAllTrials: casesAllPassed,
      planMatch: planMatched,
      planExact,
      overIncludedNodes: overIncluded,
      planMatchAllTrials: casesAllMatched,
      rubrics: Object.fromEntries(rubricStats),
      judge: Object.fromEntries(judgeStats),
      groups: { pass: groups.filter((g) => g.pass).length, total: groups.length },
      parts: Object.fromEntries(partRows.map((p) => [p.part, { pass: p.pass, total: p.total }])),
      llmCalls: sum((r) => r.llmCalls),
      toolCalls: sum((r) => r.toolCalls),
      inputTokens: sum((r) => r.inputTokens),
      outputTokens: sum((r) => r.outputTokens),
      estimatedCostUSD: Math.round(sum((r) => r.estimatedCost) * 1e4) / 1e4,
      latencyMeanMs: Math.round(sum((r) => r.latencyMs) / Math.max(1, results.length)),
      latencyP95Ms: p(0.95),
    },
  };
  const t = meta.totals;
  const summaryLine = `${t.pass}/${t.trials} trials pass (pass^k: ${t.passAllTrials}/${t.cases} cases) · plan ok ${t.planMatch}/${t.trials} (exact ${t.planExact}) · misses ${t.cassetteMiss} · fallbacks ${t.llmFallback} · errors ${t.error} · llm calls ${t.llmCalls} · est. $${t.estimatedCostUSD} · p95 ${t.latencyP95Ms}ms`;
  const modelLine = Object.entries(input.models).map(([a, m]) => `${a}=${m.provider}/${m.model}`).join(", ") || "none (rules only)";
  const gradeCell = (r: TrialResult) => {
    const failed = r.grades.filter((g) => !g.pass);
    const jf = r.judge.filter((v) => !v.pass);
    return [r.grades.length ? (failed.length ? `✗ ${failed.map((g) => `${g.rubric}${g.detail ? ` (${escape(g.detail)})` : ""}`).join("; ")}` : `✓ ${r.grades.length}`) : "-", jf.length ? `judge✗ ${jf.map((v) => `${v.rubric}: ${escape(v.reason)}`).join("; ")}` : r.judge.length ? `judge✓ ${r.judge.length}` : ""].filter(Boolean).join(" · ");
  };
  const rows = results.map((r) => `| ${r.caseId} | ${r.profile} | ${r.trial} | ${escape(r.query)} | ${r.status}${r.pass ? "" : r.status === "ok" ? " / FAIL" : ""} | ${r.planMatch === undefined ? "-" : r.planMatch ? (r.planExact ? "✓" : `✓ (+${r.planOver} extra)`) : "✗ " + escape(r.planDiff.join("; "))} | ${gradeCell(r)} | ${r.decidedBy ?? "-"}${r.needsCritic ? " → critic" : ""} | ${r.llmCalls} | ${r.toolCalls} | ${r.latencyMs} | ${r.estimatedCost.toFixed(4)} |${r.error ? ` ${escape(r.error)}` : ""}`);
  const rubricRows = [...rubricStats.entries()].sort().map(([k, s]) => `| ${k} | code | ${s.pass}/${s.total} |`);
  const judgeRows = [...judgeStats.entries()].sort().map(([k, s]) => `| ${k} | judge (${results.find((r) => r.judgeModel)?.judgeModel ?? "-"}) | ${s.pass}/${s.total} |`);
  const markdown = [
    `# Eval report · ${input.startedAt.toISOString().slice(0, 10)} · mode ${input.mode} · profile ${input.profileName}`,
    "",
    `- cases: \`${input.casesPath}\` (${t.cases} cases × ${input.trials} trial${input.trials > 1 ? "s" : ""})`,
    `- models: ${modelLine}`,
    `- variant: ${input.variant}${input.variant === "full" ? " (production behaviour)" : ""}`,
    `- mode note: ${MODE_NOTE[input.mode]}`,
    "",
    "| metric | value |",
    "|---|---:|",
    `| trials pass (status ok + all code graders) | ${t.pass}/${t.trials} |`,
    `| cases passing every trial (pass^k) | ${t.passAllTrials}/${t.cases} |`,
    `| trials with status ok | ${t.ok}/${t.trials} |`,
    `| routing plan: no required node missed (gate) | ${t.planMatch}/${t.trials} |`,
    `| routing plan: exact match incl. extra nodes | ${t.planExact}/${t.trials} (${t.overIncludedNodes} extra specialist runs) |`,
    `| routing plan ok in every trial of a case | ${t.planMatchAllTrials}/${t.cases} |`,
    `| cassette misses / LLM fallbacks / errors | ${t.cassetteMiss} / ${t.llmFallback} / ${t.error} |`,
    `| LLM calls / tool calls | ${t.llmCalls} / ${t.toolCalls} |`,
    `| tokens in / out | ${t.inputTokens} / ${t.outputTokens} |`,
    `| estimated cost (USD, from recorded usage) | ${t.estimatedCostUSD} |`,
    `| latency mean / p95 (ms) | ${t.latencyMeanMs} / ${t.latencyP95Ms} |`,
    "",
    "## 결과물 분해 (what has a ground truth, what is a property check)",
    "",
    "| answer part | ground truth | rubrics | pass |",
    "|---|---|---|---:|",
    ...partRows.map((p) => `| ${p.part} | ${p.truth} | ${p.rubrics.join(", ")} | ${p.total ? `${p.pass}/${p.total}` : "-"} |`),
    `| 일관성: 반복 실행 (pass^k) | 교차 실행 | trials=${input.trials} | ${t.passAllTrials}/${t.cases} cases |`,
    `| 일관성: 표현 변형·동조 유도 그룹 | 교차 케이스 | invariant/contrast | ${groups.length ? `${groups.filter((g) => g.pass).length}/${groups.length} groups` : "-"} |`,
    `| judge (사람 라벨로 보정 전) | 없음 · 기록만 | ${[...judgeStats.keys()].join(", ") || "-"} | ${[...judgeStats.values()].reduce((s, x) => s + x.pass, 0)}/${[...judgeStats.values()].reduce((s, x) => s + x.total, 0)} |`,
    "",
    "## Groups (cross-case consistency)",
    "",
    "| group | kind | members | pass | detail |",
    "|---|---|---:|---|---|",
    ...(groups.length ? groups.map((g) => `| ${g.group} | ${g.kind} | ${g.members} | ${g.pass ? "✓" : "✗"} | ${escape(g.detail)} |`) : ["| – | – | – | – | no grouped cases in this run |"]),
    "",
    "## Rubrics",
    "",
    "| rubric | grader | pass |",
    "|---|---|---:|",
    ...rubricRows,
    ...judgeRows,
    "",
    "Judge verdicts are reported for calibration and do not gate (plan §5).",
    "",
    "## Trials",
    "",
    "| case | profile | trial | query | status | plan | graders | verification | llm | tools | ms | $ | note |",
    "|---|---|---:|---|---|---|---|---|---:|---:|---:|---:|---|",
    ...rows,
    "",
  ].join("\n");
  return { meta, markdown, summaryLine };
}

const MODE_NOTE: Record<Mode, string> = {
  replay: "recorded LLM responses; measures code-path regressions, not model quality. Latency and cost are replayed values.",
  record: "live models; every LLM response was written to the cassette directory for later replay.",
  live: "live models, nothing recorded; measures current model behaviour.",
  rules: "no LLM; deterministic router, engines and template answer only.",
};

// ---- utils ----
function parseArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, inline] = a.slice(2).split("=", 2);
    out[k] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
  }
  return out;
}
const localStamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const escape = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
