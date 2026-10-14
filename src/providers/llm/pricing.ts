import type { Usage } from "@/orchestration/tracer";

// ponytail: USD per 1M tokens, matched by substring; unknown models yield no estimate rather than a fake one.
const PRICES: [string, number, number][] = [
  ["gpt-5.4-mini", 0.4, 1.6],
  ["gpt-5.4", 2.5, 10],
  ["gpt-5", 1.25, 10],
  ["claude-haiku", 1, 5],
  ["claude-sonnet", 3, 15],
  ["claude-opus", 15, 75],
];

export function estimateCost(model: string | undefined, usage: Usage | undefined): number | undefined {
  if (!model || !usage) return undefined;
  const p = PRICES.find(([k]) => model.toLowerCase().includes(k));
  if (!p) return undefined;
  return ((usage.inputTokens ?? 0) * p[1] + (usage.outputTokens ?? 0) * p[2]) / 1e6;
}
