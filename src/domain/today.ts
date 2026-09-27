import { z } from "zod";
import { Provenance } from "./portfolio";

export const TodayItemType = z.enum(["price_move", "fx_move", "policy", "warning", "filing"]);
export type TodayItemType = z.infer<typeof TodayItemType>;

export const TodayItem = z.object({
  id: z.string(),
  type: TodayItemType,
  title: z.string(),
  symbol: z.string().optional(),
  /** deterministic KRW impact on the connected portfolio today (0 when not a P&L event) */
  portfolioImpactKRW: z.number(),
  exposurePct: z.number().optional(),
  importance: z.number().min(0).max(1),
  scores: z.object({
    financialImpact: z.number(),
    policyRelevance: z.number(),
    modelRelevance: z.number().optional(),
  }),
  /** deterministic facts the explanation must stay within */
  facts: z.array(z.string()),
  explanation: z.string(),
  explanationBy: z.enum(["template", "llm"]),
  sources: z.array(Provenance),
});
export type TodayItem = z.infer<typeof TodayItem>;

export const TodayResponse = z.object({
  asOf: z.string(),
  totalValueKRW: z.number(),
  valuationComplete: z.boolean().optional(),
  marketMode: z.enum(["live", "fixture"]).optional(),
  dailyPnLKRW: z.number(),
  items: z.array(TodayItem),
  limitations: z.array(z.string()),
});
export type TodayResponse = z.infer<typeof TodayResponse>;
