import { describe, expect, it } from "vitest";
import { goldenToCases, loadSuite, STRATA, STRATUM_MIN } from "@/evals/cases";
import { listProfiles } from "@/evals/profiles";

/** Dataset v1 invariants (docs/eval-loop-plan.md §3): schema, unique ids, stratum minimums, holdout share, valid profiles. */
describe("eval dataset v1", () => {
  const cases = loadSuite("all");
  const holdout = loadSuite("holdout");
  const golden = goldenToCases("tests/evals/golden.json");

  it("parses every case file and the golden file", () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    expect(golden).toHaveLength(30);
  });

  it("has unique ids across cases and holdout", () => {
    const ids = [...cases, ...holdout, ...golden].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("meets the per-stratum minimum", () => {
    const count = Object.fromEntries(STRATA.map((s) => [s, cases.filter((c) => c.stratum === s).length]));
    for (const s of STRATA) expect(count[s], `${s}: ${count[s]} < ${STRATUM_MIN[s]}`).toBeGreaterThanOrEqual(STRATUM_MIN[s]);
  });

  it("keeps a holdout of at least 15% that is never used for tuning", () => {
    expect(holdout.length / (cases.length + holdout.length)).toBeGreaterThanOrEqual(0.15);
    expect(new Set(holdout.map((c) => c.stratum)).size).toBeGreaterThanOrEqual(8);
  });

  it("references only existing profiles and gives every case something checkable", () => {
    const profiles = new Set(listProfiles());
    for (const c of [...cases, ...holdout]) {
      expect(profiles.has(c.profile), `${c.id}: profile ${c.profile}`).toBe(true);
      const checkable = c.expect.plan || c.expect.trade !== undefined || c.expect.errorMatch || c.expect.policyViolation !== undefined || c.expect.mustMention.length || c.expect.mustNotMatch.length || c.expect.judge.length;
      expect(Boolean(checkable), `${c.id} has no expectation`).toBe(true);
    }
  });

  it("balances should / shouldn't: decision-heavy strata have cases with and without the simulation node", () => {
    for (const s of ["trade", "scenario", "followup", "sycophancy", "injection", "phrasing", "data-gap"] as const) {
      const withPlan = cases.filter((c) => c.stratum === s && c.expect.plan && "simulation" in c.expect.plan);
      if (withPlan.length < 2) continue;
      const values = new Set(withPlan.map((c) => c.expect.plan!.simulation));
      expect(values.size, `${s}: only simulation=${[...values][0]} cases`).toBe(2);
    }
  });
});
