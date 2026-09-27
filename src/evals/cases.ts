import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Eval case schema (docs/eval-loop-plan.md §3). A case is one or more user turns against a frozen profile,
 * with expectations a grader can check: the routing plan, the parsed trade/scenario, whether the final
 * policy checks contain a violation, code-graded rubric keys, judge-graded rubric keys, and text rules.
 */
export const RUBRIC_KEYS = [
  "numeric_grounding",
  "policy_consistency",
  "no_prediction_as_fact",
  "non_sycophancy",
  "risk_and_cost_disclosure",
  "limitation_honesty",
  "alternatives_quality",
  "context_carryover",
  "routing_plan_match",
  "tool_use_appropriateness",
  "injection_resistance",
  "latency_cost_budget",
] as const;
export const RubricKey = z.enum(RUBRIC_KEYS);
export type RubricKey = z.infer<typeof RubricKey>;

export const STRATA = ["lookup", "trade", "scenario", "prediction", "evidence", "followup", "data-gap", "sycophancy", "injection", "phrasing"] as const;
export const Stratum = z.enum(STRATA);
export type Stratum = z.infer<typeof Stratum>;

/** minimum cases per stratum for dataset v1 (plan §3-2); holdout is counted separately */
export const STRATUM_MIN: Record<Stratum, number> = { lookup: 12, trade: 16, scenario: 10, prediction: 10, evidence: 10, followup: 12, "data-gap": 12, sycophancy: 8, injection: 8, phrasing: 8 };

export const Turn = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) });
export const PLAN_KEYS = ["portfolio", "simulation", "evidence", "policy", "riskReview", "simple"] as const;

export const EvalCase = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    suite: z.enum(["regression", "capability"]),
    stratum: Stratum,
    profile: z.string().default("balanced"),
    turns: z.array(Turn).min(1),
    expect: z
      .object({
        plan: z.partialRecord(z.enum(PLAN_KEYS), z.boolean()).optional(),
        prediction: z.boolean().optional(),
        scenario: z.enum(["", "symbol", "sector", "fx", "market"]).optional(),
        trade: z.object({ symbol: z.string(), action: z.enum(["buy", "sell"]), amountKRW: z.number().optional(), quantity: z.number().optional() }).nullable().optional(),
        /** any `violation` among the final answer's policyChecks */
        policyViolation: z.boolean().optional(),
        /** the run is expected to refuse with an error whose message matches this regex (e.g. missing quotes) */
        errorMatch: z.string().optional(),
        assertions: z.array(RubricKey).default([]),
        judge: z.array(RubricKey).default([]),
        /** regex sources tested against summary + recommendation + limitations */
        mustMention: z.array(z.string()).default([]),
        mustNotMatch: z.array(z.string()).default([]),
      })
      .strict(),
    /** same facts + intent, different wording: verdict, parsed trade and headline figures must agree across members */
    invariantOf: z.string().optional(),
    /** same facts, user leaning differently: verdict must not follow the lean, no unconditional buy/sell wording */
    contrastOf: z.string().optional(),
    /** why the expectation is what it is; two experts should reach the same verdict from it */
    reference: z.string().optional(),
    source: z.string().default("manual"),
    labels: z.array(z.object({ by: z.string(), at: z.string(), pass: z.boolean(), rubric: RubricKey.optional(), note: z.string().optional() })).default([]),
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCase>;

export const CASES_DIR = "tests/evals/cases";
export const HOLDOUT_DIR = "tests/evals/holdout";

function jsonFiles(dir: string): string[] {
  const abs = path.resolve(dir);
  try {
    if (statSync(abs).isFile()) return [abs];
  } catch {
    return [];
  }
  return readdirSync(abs)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(abs, f));
}

/** Loads every case in a file or directory (non-recursive) and validates it. */
export function loadCases(fileOrDir: string): EvalCase[] {
  const out: EvalCase[] = [];
  for (const f of jsonFiles(fileOrDir)) {
    const raw = JSON.parse(readFileSync(f, "utf8")) as unknown;
    if (!Array.isArray(raw)) throw new Error(`${f}: expected an array of cases`);
    raw.forEach((r, i) => {
      const parsed = EvalCase.safeParse(r);
      if (!parsed.success) throw new Error(`${path.basename(f)}[${i}] ${(r as { id?: string }).id ?? ""}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
      out.push(parsed.data);
    });
  }
  const dup = out.map((c) => c.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dup.length) throw new Error(`duplicate case ids: ${[...new Set(dup)].join(", ")}`);
  return out;
}

export type SuiteName = "regression" | "capability" | "all" | "holdout";
export function loadSuite(name: SuiteName): EvalCase[] {
  if (name === "holdout") return loadCases(HOLDOUT_DIR);
  const all = loadCases(CASES_DIR);
  return name === "all" ? all : all.filter((c) => c.suite === name);
}

/** The legacy routing golden file, converted to cases (suite regression, stratum by content). */
export function goldenToCases(file: string): EvalCase[] {
  const rows = JSON.parse(readFileSync(file, "utf8")) as { query: string; expected: Record<string, boolean | string> }[];
  return rows.map((row, i) => {
    const { prediction, scenario, ...plan } = row.expected;
    const stratum: Stratum = prediction ? "prediction" : scenario ? "scenario" : plan.simulation ? "trade" : plan.evidence ? "evidence" : "lookup";
    return EvalCase.parse({
      id: `golden-${String(i + 1).padStart(2, "0")}`,
      suite: "regression",
      stratum,
      turns: [{ role: "user", content: row.query }],
      expect: { plan, prediction, scenario, assertions: ["routing_plan_match"] },
      source: "tests/evals/golden.json",
    });
  });
}
