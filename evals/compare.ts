/**
 * Compares two eval report JSONs (before/after a change, or two system variants) and prints the delta.
 *
 *   npm run eval:compare -- evals/reports/<before>.json evals/reports/<after>.json [--out evals/reports/compare-<stamp>.md]
 *
 * Relative comparison is how we judge changes to prose that has no reference answer: the same cases, the same graders,
 * what moved. Per-case transitions (pass→fail) matter more than the aggregate.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Trial = { caseId: string; trial: number; status: string; pass: boolean; planMatch?: boolean; planExact?: boolean; llmCalls: number; toolCalls: number; inputTokens: number; outputTokens: number; latencyMs: number; estimatedCost: number; needsCritic?: boolean; grades: { rubric: string; pass: boolean; detail?: string }[]; judge: { rubric: string; pass: boolean }[] };
type Report = { mode: string; profile: string; variant?: string; generatedAt: string; models: Record<string, { model: string }>; totals: Record<string, number | Record<string, unknown>>; results: Trial[] };

const [a, b, ...rest] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: compare <before.json> <after.json> [--out file.md]");
  process.exit(2);
}
const outArg = rest.indexOf("--out") >= 0 ? rest[rest.indexOf("--out") + 1] : undefined;
const A = JSON.parse(readFileSync(a, "utf8")) as Report;
const B = JSON.parse(readFileSync(b, "utf8")) as Report;

const key = (t: Trial) => `${t.caseId}#${t.trial}`;
const mapA = new Map(A.results.map((t) => [key(t), t]));
const mapB = new Map(B.results.map((t) => [key(t), t]));
const common = [...mapA.keys()].filter((k) => mapB.has(k));

function agg(rs: Trial[]) {
  const n = rs.length || 1;
  const sum = (f: (t: Trial) => number) => rs.reduce((s, t) => s + f(t), 0);
  const lat = rs.map((t) => t.latencyMs).sort((x, y) => x - y);
  const rubric = new Map<string, { p: number; n: number }>();
  for (const t of rs) for (const g of t.grades) {
    const s = rubric.get(g.rubric) ?? { p: 0, n: 0 };
    s.n++;
    if (g.pass) s.p++;
    rubric.set(g.rubric, s);
  }
  return {
    pass: rs.filter((t) => t.pass).length,
    planOk: rs.filter((t) => t.planMatch).length,
    planExact: rs.filter((t) => t.planExact).length,
    critic: rs.filter((t) => t.needsCritic).length,
    llm: sum((t) => t.llmCalls),
    tokens: sum((t) => t.inputTokens + t.outputTokens),
    cost: sum((t) => t.estimatedCost),
    p50: lat[Math.floor(0.5 * (lat.length - 1))] ?? 0,
    p95: lat[Math.floor(0.95 * (lat.length - 1))] ?? 0,
    n,
    rubric,
  };
}
const ra = agg(common.map((k) => mapA.get(k)!));
const rb = agg(common.map((k) => mapB.get(k)!));
const d = (x: number, y: number, fmt: (v: number) => string = String) => `${fmt(x)} → ${fmt(y)} (${y - x >= 0 ? "+" : ""}${fmt(y - x)})`;
const money = (v: number) => `$${v.toFixed(3)}`;

const lines = [
  `# Eval comparison · ${new Date().toISOString().slice(0, 10)}`,
  "",
  `- A (before): \`${a}\` · mode ${A.mode} · variant ${A.variant ?? "full"} · ${A.generatedAt}`,
  `- B (after):  \`${b}\` · mode ${B.mode} · variant ${B.variant ?? "full"} · ${B.generatedAt}`,
  `- common trials: ${common.length} (A only: ${A.results.length - common.length}, B only: ${B.results.length - common.length})`,
  "",
  "| metric | A → B |",
  "|---|---|",
  `| trials pass | ${d(ra.pass, rb.pass)} / ${common.length} |`,
  `| routing plan ok (gate) | ${d(ra.planOk, rb.planOk)} |`,
  `| routing plan exact | ${d(ra.planExact, rb.planExact)} |`,
  `| trials that called the Critic | ${d(ra.critic, rb.critic)} |`,
  `| LLM calls | ${d(ra.llm, rb.llm)} |`,
  `| tokens (in+out) | ${d(ra.tokens, rb.tokens)} |`,
  `| estimated cost | ${d(ra.cost, rb.cost, money)} |`,
  `| latency p50 / p95 (ms) | ${d(ra.p50, rb.p50)} / ${d(ra.p95, rb.p95)} |`,
  "",
  "## Rubrics",
  "",
  "| rubric | A | B |",
  "|---|---:|---:|",
  ...[...new Set([...ra.rubric.keys(), ...rb.rubric.keys()])].sort().map((k) => `| ${k} | ${fmtR(ra.rubric.get(k))} | ${fmtR(rb.rubric.get(k))} |`),
  "",
  "## Per-case transitions",
  "",
  "| case | A | B | what changed |",
  "|---|---|---|---|",
];
let moved = 0;
for (const k of common) {
  const x = mapA.get(k)!;
  const y = mapB.get(k)!;
  const sa = x.status === "ok" ? (x.pass ? "pass" : "fail") : x.status;
  const sb = y.status === "ok" ? (y.pass ? "pass" : "fail") : y.status;
  const failedA = new Set(x.grades.filter((g) => !g.pass).map((g) => g.rubric));
  const failedB = new Set(y.grades.filter((g) => !g.pass).map((g) => g.rubric));
  const fixed = [...failedA].filter((r) => !failedB.has(r));
  const broke = [...failedB].filter((r) => !failedA.has(r));
  if (sa === sb && !fixed.length && !broke.length) continue;
  moved++;
  lines.push(`| ${k} | ${sa} | ${sb} | ${[fixed.length && `fixed: ${fixed.join(", ")}`, broke.length && `broke: ${broke.join(", ")}`].filter(Boolean).join("; ") || "status only"} |`);
}
if (!moved) lines.push("| – | – | – | no per-case changes |");
lines.push("");

function fmtR(s?: { p: number; n: number }) {
  return s ? `${s.p}/${s.n}` : "-";
}
const out = outArg ?? path.join("evals/reports", `compare-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nreport: ${out}`);
