import { llmAvailable } from "@/providers/llm/registry";
import type { DecisionModel } from "./interface";
import { ClefDecisionModel } from "./clef";
import { LLMDecisionModel } from "./llm-fallback";

export * from "./interface";

/** DECISION_PROVIDER=clef (default) with CLEF_BASE_URL -> Clef; otherwise LLM structured output; null when nothing is configured. */
export function decisionModel(): DecisionModel | null {
  const pref = process.env.DECISION_PROVIDER ?? "clef";
  if (pref === "clef" && process.env.CLEF_BASE_URL) return new ClefDecisionModel(process.env.CLEF_BASE_URL);
  if (llmAvailable()) return new LLMDecisionModel();
  return null;
}

export const ROUTING_THRESHOLD = Number(process.env.ROUTING_THRESHOLD ?? 0.7);
export const VERIFICATION_THRESHOLD = Number(process.env.VERIFICATION_THRESHOLD ?? 0.3);
