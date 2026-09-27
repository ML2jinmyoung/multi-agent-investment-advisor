import { readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { InvestmentPolicy } from "@/domain/policy";
import { PortfolioInput } from "@/domain/portfolio-input";
import { loadFixture } from "@/lib/fixtures";
import { savePolicy } from "@/services/policy-store";
import { savePortfolioInput } from "@/services/portfolio-input-store";

/**
 * Eval profiles: holdings + cash + policy frozen in `fixtures/profiles/*.json`. A profile is installed under
 * its own userId through the same stores a visitor uses, so evals go through the ordinary snapshot path
 * (manual holdings + fixture market data) and never touch live market APIs or the demo user.
 */
export const EvalProfile = z.object({ name: z.string(), description: z.string(), input: PortfolioInput, policy: InvestmentPolicy });
export type EvalProfile = z.infer<typeof EvalProfile>;

/** `demo` is the built-in fixture account set (Toss fixture + mock MyData), not a file. */
export const DEMO_PROFILE = "demo";

export function listProfiles(): string[] {
  return [DEMO_PROFILE, ...readdirSync(path.join(process.cwd(), "fixtures", "profiles")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort()];
}

export function loadProfile(name: string): EvalProfile {
  const p = EvalProfile.parse(loadFixture(`profiles/${name}.json`));
  if (p.name !== name) throw new Error(`profile file ${name}.json declares name ${p.name}`);
  return p;
}

export const profileUserId = (name: string) => (name === DEMO_PROFILE ? "demo" : `eval:${name}`);

/** Writes the profile's holdings and policy under `eval:<name>` and returns that userId. Idempotent. */
export async function installProfile(name: string): Promise<string> {
  if (name === DEMO_PROFILE) return "demo";
  const p = loadProfile(name);
  const userId = profileUserId(name);
  await savePortfolioInput(userId, p.input);
  await savePolicy(p.policy, userId);
  return userId;
}
