import { generateObject } from "ai";
import { z } from "zod";
import type { AgentAnswer, VerificationResult } from "@/domain/agent";
import { modelFor } from "@/providers/llm/registry";
import type { RunContext } from "./context";
import { CRITIC_SYSTEM } from "./prompts";

const Critique = z.object({
  problems: z.array(z.object({ kind: z.enum(["unsupported_claim", "missing_evidence", "stale_data", "policy_inconsistency", "prediction_as_fact", "missing_risk", "contradictory_evidence"]), detail: z.string() })),
  verdict: z.enum(["pass", "revise"]),
});
export type Critique = z.infer<typeof Critique>;

/** Runs only when verification flags a problem. Returns issues for the synthesizer to revise. */
export async function runCritic(ctx: RunContext, answer: AgentAnswer, verification: VerificationResult): Promise<Critique> {
  return ctx.tracer.step(
    "llm-critic",
    "llm",
    async (rec) => {
      const { model, config } = await modelFor("critic");
      rec.provider = config.provider;
      rec.model = config.model;
      const r = await generateObject({
        model,
        schema: Critique,
        system: CRITIC_SYSTEM,
        prompt: [
          `USER: ${ctx.message}`,
          `VERIFICATION FLAGS: ${JSON.stringify(verification.scores)}`,
          // F-002: the agents cite policy limits from ctx.policy; without it the critic flagged those numbers as invented
          `DATA (as of ${ctx.snapshot.asOf}): ${JSON.stringify({ portfolio: ctx.snapshot, investmentPolicy: ctx.policy, simulation: ctx.simulationView, policyChecks: ctx.policyChecks })}`,
          `DRAFT ANSWER: ${JSON.stringify(answer)}`,
        ].join("\n\n"),
      });
      ctx.tracer.usage(rec, r.usage, config.model);
      return r.object;
    },
    { input: { flags: verification.scores } },
  );
}
