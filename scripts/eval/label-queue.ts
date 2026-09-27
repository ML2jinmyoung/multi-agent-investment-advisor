/**
 * Builds a human labeling queue from an eval report (Phase 3, docs/eval-loop-plan.md §5).
 *
 *   npm run eval:queue -- --report evals/reports/<stamp>-<mode>-<profile>.json [--db file:./data/eval.db] [--out evals/labels]
 *
 * Output: <out>/queue-<stamp>.md (answers to read) and <out>/queue-<stamp>.csv (one row per trial × judge rubric,
 * with `humanPass` and `note` left blank). Fill the CSV, then run `npm run eval:calibrate`.
 * Labels are binary on purpose (Husain 2024: good/bad first, scales later).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const reportPath = opt("report") ?? "";
if (!reportPath || !existsSync(reportPath)) {
  console.error("usage: label-queue --report <report.json> [--db <url>] [--out evals/labels]");
  process.exit(2);
}
process.env.DATABASE_URL = opt("db") ?? "file:./data/eval.db";
const outDir = opt("out") ?? "evals/labels";

type Trial = { caseId: string; profile: string; trial: number; query: string; runId?: string; status: string; judge: { rubric: string; pass: boolean; quote: string; reason: string }[]; grades: { rubric: string; pass: boolean; detail?: string }[] };
type Report = { mode: string; generatedAt: string; results: Trial[] };

async function main() {
  const { eq } = await import("drizzle-orm");
  const { getDb, schema } = await import("@/db");
  const { AgentAnswer } = await import("@/domain/agent");
  const { RUBRIC_TEXT } = await import("../../evals/graders/judge");
  const db = await getDb();
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
  const stamp = path.basename(reportPath).replace(/\.json$/, "");
  const trials = report.results.filter((r) => r.runId && r.judge.length);
  if (!trials.length) {
    console.error("report has no judge-graded trials (run without --no-judge, mode != rules)");
    process.exit(2);
  }
  const md: string[] = [`# Labeling queue · ${stamp}`, "", `Report: \`${reportPath}\` · mode ${report.mode} · ${trials.length} trials to label.`, "", "각 항목에 대해 **pass/fail만** 판정하고 CSV의 humanPass(true/false)와 note를 채운다. 애매하면 note에 이유를 쓰고 pass로 둔다(명백한 위반만 fail). 기준 정의:", "", ...Object.entries(RUBRIC_TEXT).map(([k, v]) => `- \`${k}\`: ${v}`), ""];
  const csv: string[] = ["runId,caseId,trial,rubric,judgePass,humanPass,note"];
  for (const t of trials) {
    const [row] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, t.runId!));
    const answer = row?.answer ? AgentAnswer.safeParse(JSON.parse(row.answer)) : undefined;
    md.push(`## ${t.caseId} · trial ${t.trial} · run \`${t.runId}\``, "", `**Q:** ${t.query}`, "");
    if (answer?.success) {
      const a = answer.data;
      md.push(`**요약:** ${a.summary}`, "", `**권고:** ${a.recommendation}`, "");
      if (a.policyChecks.length) md.push(`**정책 점검(코드):** ${a.policyChecks.map((c) => `${c.label}${c.subject ? ` ${c.subject}` : ""}=${c.status}`).join(", ")}`, "");
      if (a.risks.length) md.push(`**위험:** ${a.risks.map((r) => r.title).join(" · ")}`, "");
      if (a.limitations.length) md.push(`**한계:**`, ...a.limitations.map((l) => `- ${l}`), "");
    } else md.push("_(answer not found in the eval DB)_", "");
    md.push("| rubric | judge | quote | reason | human |", "|---|---|---|---|---|");
    for (const v of t.judge) {
      md.push(`| ${v.rubric} | ${v.pass ? "pass" : "fail"} | ${esc(v.quote)} | ${esc(v.reason)} | ☐ pass ☐ fail |`);
      csv.push([t.runId, t.caseId, t.trial, v.rubric, v.pass, "", ""].map(csvCell).join(","));
    }
    const failedCode = t.grades.filter((g) => !g.pass);
    if (failedCode.length) md.push("", `코드 채점 실패: ${failedCode.map((g) => `${g.rubric}${g.detail ? ` (${g.detail})` : ""}`).join("; ")}`);
    md.push("");
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `queue-${stamp}.md`), md.join("\n"));
  writeFileSync(path.join(outDir, `queue-${stamp}.csv`), csv.join("\n") + "\n");
  console.log(`${path.join(outDir, `queue-${stamp}.md`)}\n${path.join(outDir, `queue-${stamp}.csv`)} (${csv.length - 1} rows)`);
}
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
