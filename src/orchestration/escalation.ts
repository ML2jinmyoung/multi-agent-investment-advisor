import { type DecisionModel, ROUTING_THRESHOLD, VERIFICATION_THRESHOLD } from "@/decision";
import type { AgentAnswer, RoutingDecision, VerificationKey, VerificationResult } from "@/domain/agent";
import { VERIFICATION_KEYS } from "@/domain/agent";
import type { PolicyCheck } from "@/domain/policy";
import type { Tracer } from "./tracer";

export const routingNeedsEscalation = (r: RoutingDecision) => r.decidedBy === "clef" && r.confidence < ROUTING_THRESHOLD;

const PREDICTION_AS_FACT = /(오를\s*것입니다|상승할\s*것입니다|떨어질\s*것입니다|하락할\s*것입니다|확실히\s*(오|상승|하락)|반드시\s*(오|상승)|will\s+(definitely\s+)?(rise|go up|fall))/i;
const UNQUALIFIED_BUY = /(매수해도\s*(됩니다|좋습니다|괜찮)|사도\s*(됩니다|좋습니다|괜찮)|추가\s*매수를\s*권)/;

const QUESTIONS: Record<VerificationKey, string> = {
  unsupported_claim: "Does the answer contain a factual claim that is not supported by the listed evidence or data?",
  policy_conflict: "Does the recommendation conflict with the user's investment policy checks?",
  prediction_as_fact: "Does the answer present uncertain future performance as a fact?",
  missing_material_risk: "Is an important risk for this decision omitted from the answer?",
  stale_evidence: "Does the answer rely on data that is stale or explicitly flagged as unavailable?",
};

/** Code checks first (cheap, deterministic), then Clef atomic questions; LLM Critic runs only above threshold. */
export async function verifyAnswer(
  input: { message: string; answer: AgentAnswer; policyChecks: PolicyCheck[]; dataAsOf: string; warnings: string[] },
  dm: DecisionModel | null,
  tracer: Tracer,
): Promise<VerificationResult> {
  const t0 = Date.now();
  const text = `${input.answer.summary} ${input.answer.recommendation}`;
  const rule: Record<VerificationKey, number> = {
    unsupported_claim: 0,
    policy_conflict: input.policyChecks.some((c) => c.status === "violation") && UNQUALIFIED_BUY.test(text) && !/원칙|한도|위반/.test(text) ? 0.9 : 0,
    prediction_as_fact: PREDICTION_AS_FACT.test(text) ? 0.9 : 0,
    missing_material_risk: input.answer.risks.length === 0 ? 0.7 : 0,
    stale_evidence: input.warnings.length && !input.answer.limitations.length ? 0.6 : 0,
  };

  return tracer.step(
    "verification",
    "decision",
    async (rec) => {
      let scores = rule;
      let decidedBy: VerificationResult["decidedBy"] = "rule";
      if (dm) {
        try {
          // compact state: a System-One model needs the claims, not the whole answer object
          // state is re-encoded once per question, so keep it ~1k chars
          const a = input.answer;
          const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n) + "…" : t);
          const state = {
            question: input.message,
            summary: cut(a.summary, 240),
            recommendation: cut(a.recommendation, 300),
            evidence: a.evidence.slice(0, 8).map((e) => cut(`${e.claim} [${e.source}]`, 110)),
            risks: a.risks.slice(0, 5).map((r) => r.title),
            limitations: a.limitations.slice(0, 4).map((l) => cut(l, 90)),
            policyChecks: input.policyChecks.filter((c) => c.status !== "ok").map((c) => `${c.label}${c.subject ? ` ${c.subject}` : ""}: ${c.status}`),
            dataAsOf: input.dataAsOf.slice(0, 10),
            dataWarnings: input.warnings.slice(0, 3).map((w) => cut(w, 80)),
          };
          const r = await dm.evaluateMany(state, QUESTIONS);
          scores = Object.fromEntries(VERIFICATION_KEYS.map((k) => [k, Math.max(rule[k], r.probabilities[k])])) as Record<VerificationKey, number>;
          decidedBy = dm.name;
          rec.provider = dm.name;
          rec.model = r.meta.model;
          tracer.usage(rec, r.meta, r.meta.model);
        } catch (e) {
          rec.input = { fallback: "rule", reason: (e as Error).message };
        }
      }
      const needsCritic = Object.values(scores).some((v) => v >= VERIFICATION_THRESHOLD);
      const result: VerificationResult = { scores, needsCritic, decidedBy, latencyMs: Date.now() - t0 };
      rec.output = result;
      return result;
    },
  );
}
