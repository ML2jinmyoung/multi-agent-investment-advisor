import type { SecurityMeta } from "@/domain/portfolio";
import { loadFixture } from "@/lib/fixtures";

const table = loadFixture<Record<string, Omit<SecurityMeta, "symbol">>>("market/securities.json");

export function getSecurityMeta(symbol: string): SecurityMeta | undefined {
  const m = table[symbol];
  return m ? { symbol, ...m } : undefined;
}

/** Unknown symbols degrade to "other"; nothing is invented. */
export function securityMetaOrUnknown(symbol: string, hint: Partial<SecurityMeta> = {}): SecurityMeta {
  return (
    getSecurityMeta(symbol) ?? {
      symbol,
      name: hint.name ?? symbol,
      assetType: hint.assetType ?? "other",
      assetClass: hint.assetClass ?? (hint.assetType === "stock" ? "equity" : hint.assetType === "cash" ? "cash" : hint.assetType === "bond" ? "bond" : "other"),
      market: hint.market ?? "OTHER",
      currency: hint.currency ?? "KRW",
      sector: hint.sector,
      exposureCountry: hint.exposureCountry ?? hint.market ?? "OTHER",
      exposureCurrency: hint.exposureCurrency ?? hint.currency ?? "KRW",
    }
  );
}
