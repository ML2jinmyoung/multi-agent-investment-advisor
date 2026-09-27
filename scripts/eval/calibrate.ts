/**
 * Judge ↔ human calibration (Phase 3). Reads filled label CSVs, stores them in `run_labels`, and reports per-rubric
 * agreement, Cohen's κ, and the judge's precision/recall for catching human-marked failures.
 *
 *   npm run eval:calibrate -- [--labels evals/labels] [--db file:./data/eval.db] [--by <labeler>]
 *
 * Also prints, per verification key, how the runtime `verifyAnswer` scores separate human pass/fail for the matching
 * rubric (policy_conflict ↔ policy_consistency, prediction_as_fact ↔ no_prediction_as_fact, unsupported_claim ↔
 * numeric_grounding, stale_evidence ↔ limitation_honesty): the table to pick VERIFICATION_THRESHOLD from (plan §5-4).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
process.env.DATABASE_URL = opt("db") ?? "file:./data/eval.db";
const labelsDir = opt("labels") ?? "evals/labels";
const labeler = `human:${opt("by") ?? "owner"}`;

type Row = { runId: string; caseId: string; trial: string; rubric: string; judgePass: boolean; humanPass: boolean; note: string };
const VERIFICATION_FOR: Record<string, string> = { policy_consistency: "policy_conflict", no_prediction_as_fact: "prediction_as_fact", numeric_grounding: "unsupported_claim", limitation_honesty: "stale_evidence" };

function parseCsv(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift()!.split(",");
  const idx = (k: string) => header.indexOf(k);
  const rows: Row[] = [];
  for (const line of lines) {
    const cells = splitCsv(line);
    const human = cells[idx("humanPass")]?.trim().toLowerCase();
    if (human !== "true" && human !== "false") continue; // unlabeled
    rows.push({ runId: cells[idx("runId")], caseId: cells[idx("caseId")], trial: cells[idx("trial")], rubric: cells[idx("rubric")], judgePass: cells[idx("judgePass")].trim() === "true", humanPass: human === "true", note: cells[idx("note")] ?? "" });
  }
  return rows;
}
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function kappa(pairs: [boolean, boolean][]): number {
  const n = pairs.length;
  if (!n) return NaN;
  const agree = pairs.filter(([a, b]) => a === b).length / n;
  const pa = pairs.filter(([a]) => a).length / n;
  const pb = pairs.filter(([, b]) => b).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return pe === 1 ? 1 : (agree - pe) / (1 - pe);
}

async function main() {
  const { eq, inArray } = await import("drizzle-orm");
  const { getDb, schema } = await import("@/db");
  const db = await getDb();
  if (!existsSync(labelsDir)) fail(`no ${labelsDir}; run eval:queue first`);
  const files = readdirSync(labelsDir).filter((f) => f.endsWith(".csv"));
  const rows = files.flatMap((f) => parseCsv(readFileSync(path.join(labelsDir, f), "utf8")));
  if (!rows.length) fail("no labeled rows (fill humanPass with true/false)");

  // store human labels (idempotent per run × rubric × labeler)
  const existing = await db.select().from(schema.runLabels).where(inArray(schema.runLabels.runId, [...new Set(rows.map((r) => r.runId))]));
  let inserted = 0;
  for (const r of rows) {
    if (existing.some((e) => e.runId === r.runId && e.rubricKey === r.rubric && e.labeler === labeler)) continue;
    await db.insert(schema.runLabels).values({ id: randomUUID(), runId: r.runId, caseId: r.caseId, rubricKey: r.rubric, pass: r.humanPass, labeler, note: r.note || null, createdAt: new Date().toISOString() });
    inserted++;
  }

  // judge vs human
  const byRubric = new Map<string, Row[]>();
  for (const r of rows) byRubric.set(r.rubric, [...(byRubric.get(r.rubric) ?? []), r]);
  const lines = [`# Judge calibration · ${new Date().toISOString().slice(0, 10)}`, "", `${rows.length} human labels from ${files.length} file(s); ${inserted} new rows stored in run_labels as \`${labeler}\`.`, "", "| rubric | n | agreement | κ | judge precision (fail) | judge recall (fail) | human fail rate | gate? |", "|---|---:|---:|---:|---:|---:|---:|---|"];
  for (const [rubric, rs] of [...byRubric.entries()].sort()) {
    const k = kappa(rs.map((r) => [r.judgePass, r.humanPass]));
    const tp = rs.filter((r) => !r.judgePass && !r.humanPass).length;
    const fp = rs.filter((r) => !r.judgePass && r.humanPass).length;
    const fn = rs.filter((r) => r.judgePass && !r.humanPass).length;
    const prec = tp + fp ? tp / (tp + fp) : NaN;
    const rec = tp + fn ? tp / (tp + fn) : NaN;
    const agree = rs.filter((r) => r.judgePass === r.humanPass).length / rs.length;
    lines.push(`| ${rubric} | ${rs.length} | ${pct(agree)} | ${fmt(k)} | ${pct(prec)} | ${pct(rec)} | ${pct(rs.filter((r) => !r.humanPass).length / rs.length)} | ${k >= 0.7 && rs.length >= 20 ? "eligible" : "track only"} |`);
  }
  lines.push("", "Gate rule (plan §5): κ ≥ 0.7 on ≥ 20 labels. Below 0.6 the rubric stays report-only.", "");

  // verification scores vs human labels
  const runIds = [...new Set(rows.map((r) => r.runId))];
  const steps = await db.select().from(schema.agentSteps).where(inArray(schema.agentSteps.runId, runIds));
  const verif = new Map<string, Record<string, number>>();
  for (const s of steps) if (s.name === "verification" && s.output) {
    try {
      verif.set(s.runId, (JSON.parse(s.output) as { scores: Record<string, number> }).scores);
    } catch {}
  }
  lines.push("## Runtime verification scores vs human labels", "", "For each threshold: share of human-failed answers the score would send to the Critic (recall) and share of human-passed answers it would needlessly send (false alarm).", "", "| rubric ↔ verification key | n | thr 0.2 recall / false alarm | thr 0.3 | thr 0.5 | thr 0.7 |", "|---|---:|---|---|---|---|");
  for (const [rubric, key] of Object.entries(VERIFICATION_FOR)) {
    const rs = (byRubric.get(rubric) ?? []).filter((r) => verif.has(r.runId));
    if (!rs.length) continue;
    const cell = (thr: number) => {
      const flagged = (r: Row) => (verif.get(r.runId)![key] ?? 0) >= thr;
      const fails = rs.filter((r) => !r.humanPass);
      const passes = rs.filter((r) => r.humanPass);
      return `${pct(fails.length ? fails.filter(flagged).length / fails.length : NaN)} / ${pct(passes.length ? passes.filter(flagged).length / passes.length : NaN)}`;
    };
    lines.push(`| ${rubric} ↔ ${key} | ${rs.length} | ${cell(0.2)} | ${cell(0.3)} | ${cell(0.5)} | ${cell(0.7)} |`);
  }
  void eq;
  const out = path.join("evals/reports", `calibration-${new Date().toISOString().slice(0, 10)}.md`);
  mkdirSync("evals/reports", { recursive: true });
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`\nreport: ${out}`);
}
const pct = (v: number) => (Number.isNaN(v) ? "-" : `${Math.round(v * 100)}%`);
const fmt = (v: number) => (Number.isNaN(v) ? "-" : v.toFixed(2));
function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
