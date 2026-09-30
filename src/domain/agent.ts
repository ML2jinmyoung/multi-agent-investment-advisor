import { z } from "zod";
import { EvidenceItem } from "./evidence";
import type { TradeDraft } from "./ledger-parse";
import { PolicyCheck } from "./policy";

export const Alternative = z.object({
  title: z.string(),
  description: z.string(),
});
export const RiskItem = z.object({
  title: z.string(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});
export const CostItem = z.object({
  label: z.string(),
  amountKRW: z.number().optional(),
  note: z.string().optional(),
});

export const AgentAnswer = z.object({
  summary: z.string(),
  evidence: z.array(EvidenceItem),
  alternatives: z.array(Alternative),
  risks: z.array(RiskItem),
  costs: z.array(CostItem),
  policyChecks: z.array(PolicyCheck),
  recommendation: z.string(),
  limitations: z.array(z.string()),
});
export type AgentAnswer = z.infer<typeof AgentAnswer>;

export const ROUTING_KEYS = [
  "needs_portfolio_data",
  "needs_simulation",
  "needs_external_evidence",
  "needs_policy_check",
  "needs_risk_review",
] as const;
export type RoutingKey = (typeof ROUTING_KEYS)[number];

export const RoutingDecision = z.object({
  scores: z.record(z.enum(ROUTING_KEYS), z.number().min(0).max(1)),
  confidence: z.number().min(0).max(1),
  decidedBy: z.enum(["jev", "llm", "rule"]),
  escalated: z.boolean(),
  symbols: z.array(z.string()),
  trade: z
    .object({ symbol: z.string(), action: z.enum(["buy", "sell"]), amountKRW: z.number().optional(), quantity: z.number().optional() })
    .optional(),
  scenario: z
    .object({ kind: z.enum(["symbol", "sector", "fx", "market"]), target: z.string(), changePct: z.number() })
    .optional(),
  isPredictionRequest: z.boolean(),
  latencyMs: z.number(),
});
export type RoutingDecision = z.infer<typeof RoutingDecision>;

export const VERIFICATION_KEYS = [
  "unsupported_claim",
  "policy_conflict",
  "prediction_as_fact",
  "missing_material_risk",
  "stale_evidence",
] as const;
export type VerificationKey = (typeof VERIFICATION_KEYS)[number];

export const VerificationResult = z.object({
  scores: z.record(z.enum(VERIFICATION_KEYS), z.number().min(0).max(1)),
  needsCritic: z.boolean(),
  decidedBy: z.enum(["jev", "llm", "rule"]),
  latencyMs: z.number(),
});
export type VerificationResult = z.infer<typeof VerificationResult>;

/** SSE events streamed from POST /api/agent */
export type AgentStreamEvent =
  | { type: "run"; runId: string }
  | { type: "routing"; routing: RoutingDecision }
  | {
      type: "step";
      name: string;
      status: "started" | "ok" | "error" | "skipped";
      detail?: string;
      kind?: "decision" | "llm" | "deterministic" | "skipped";
      provider?: string;
      model?: string;
      latencyMs?: number;
      parallelGroup?: string;
    }
  | { type: "verification"; verification: VerificationResult }
  | { type: "answer"; answer: AgentAnswer }
  | { type: "error"; message: string }
  /** UI-only notice (e.g. demo AI quota used up); not part of the answer */
  | { type: "notice"; message: string }
  /** a trade the user says they already made; the chat shows it for confirmation before the ledger changes */
  | { type: "trade_draft"; draft: TradeDraft; accounts: { id: string; label: string }[] }
  | { type: "done" };
