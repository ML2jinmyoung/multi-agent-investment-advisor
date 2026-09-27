import { z } from "zod";

export const PortfolioInput = z.object({
  holdings: z.array(z.object({
    symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.-]{0,19}$/),
    quantity: z.number().finite().positive().max(1e9),
    averagePrice: z.number().finite().nonnegative().max(1e9).optional(),
  }).strict()).max(40),
  cashKRW: z.number().finite().nonnegative().max(1e13),
  cashUSD: z.number().finite().nonnegative().max(1e10),
}).strict().refine((v) => new Set(v.holdings.map((h) => h.symbol)).size === v.holdings.length, "동일 종목은 하나로 합쳐 입력하세요.");
export type PortfolioInput = z.infer<typeof PortfolioInput>;
