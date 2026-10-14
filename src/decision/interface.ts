export interface DecisionMeta {
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}
export interface ChoiceDecision<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
  meta: DecisionMeta;
}
export interface ScoreDecision {
  score: number;
  confidence: number;
  probabilities?: Record<string, number>;
  meta: DecisionMeta;
}
export interface ProbabilityDecision {
  probability: number;
  meta: DecisionMeta;
}
export interface ManyDecision<K extends string> {
  probabilities: Record<K, number>;
  meta: DecisionMeta;
}
export interface ScoreCriteria {
  question: string;
  /** ordered levels, low -> high (2..10) */
  levels: string[];
}
export type YesNoQuestion = string | { question: string; true?: string; false?: string };

/**
 * System-One decision model: routing, scoring, verification. Never generates prose.
 * Implementations: ClefDecisionModel (Cloudflare Clef), LLMDecisionModel (structured-output fallback).
 */
export interface DecisionModel {
  readonly name: "clef" | "llm";
  choice<T extends string>(state: unknown, choices: readonly T[] | Record<T, string | null>, question: string): Promise<ChoiceDecision<T>>;
  score(state: unknown, criteria: ScoreCriteria): Promise<ScoreDecision>;
  evaluate(state: unknown, statement: string, criteria?: { true?: string; false?: string }): Promise<ProbabilityDecision>;
  /** several atomic yes/no questions about the same state in one call */
  evaluateMany<K extends string>(state: unknown, statements: Record<K, YesNoQuestion>): Promise<ManyDecision<K>>;
}

export class DecisionUnavailableError extends Error {}

/** Mean decisiveness: 0 when answers sit at 0.5, 1 when every answer is 0 or 1. */
export function confidenceOf(probabilities: Record<string, number>): number {
  const ps = Object.values(probabilities);
  return ps.length ? ps.reduce((s, p) => s + Math.abs(p - 0.5) * 2, 0) / ps.length : 0;
}

export const toChoiceMap = <T extends string>(choices: readonly T[] | Record<T, string | null>): Record<T, string | null> =>
  Array.isArray(choices) ? (Object.fromEntries(choices.map((c) => [c, null])) as Record<T, string | null>) : (choices as Record<T, string | null>);
