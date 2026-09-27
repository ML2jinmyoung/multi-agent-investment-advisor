import type { Filing, FinancialStatements } from "@/domain/evidence";
import { DataProviderError } from "@/domain/portfolio";
import { loadFixture } from "@/lib/fixtures";

const SOURCE = "SEC EDGAR";
const FORMS = new Set(["10-K", "10-Q", "8-K"]);
type SecFiling = { accessionNumber: string; filingDate: string; form: string; primaryDocument: string };
type Submissions = { cik: string; filings: { recent: { accessionNumber: string[]; filingDate: string[]; form: string[]; primaryDocument: string[] } } };
type Facts = { facts: Record<string, Record<string, { units: Record<string, { end: string; val: number; fy: number; fp: string; form: string }[]> }>> };

let tickerMap: Promise<Record<string, string>> | undefined;

export class SecProvider {
  readonly source = SOURCE;
  constructor(private userAgent: string | undefined) {}

  private async get<T>(url: string): Promise<T> {
    if (!this.userAgent) throw new DataProviderError("AUTH_FAILED", SOURCE, "SEC_USER_AGENT missing");
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": this.userAgent, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new DataProviderError("NETWORK_ERROR", SOURCE);
    }
    if (res.status === 429 || res.status === 403) throw new DataProviderError("RATE_LIMITED", SOURCE);
    if (res.status === 404) throw new DataProviderError("NOT_AVAILABLE", SOURCE, url);
    if (!res.ok) throw new DataProviderError("NETWORK_ERROR", SOURCE, String(res.status));
    return (await res.json()) as T;
  }

  private async cik(ticker: string): Promise<string> {
    tickerMap ??= this.get<Record<string, { cik_str: number; ticker: string }>>("https://www.sec.gov/files/company_tickers.json").then((j) =>
      Object.fromEntries(Object.values(j).map((r) => [r.ticker.toUpperCase(), String(r.cik_str).padStart(10, "0")])),
    );
    const cik = (await tickerMap)[ticker.toUpperCase()];
    if (!cik) throw new DataProviderError("NOT_AVAILABLE", SOURCE, `no CIK for ${ticker}`);
    return cik;
  }

  async getRecentFilings(symbol: string, days = 30): Promise<Filing[]> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    let rows: SecFiling[];
    let cik = "";
    let isMock = false;
    if (this.userAgent) {
      cik = await this.cik(symbol);
      const s = await this.get<Submissions>(`https://data.sec.gov/submissions/CIK${cik}.json`);
      const r = s.filings.recent;
      rows = r.accessionNumber.map((a, i) => ({ accessionNumber: a, filingDate: r.filingDate[i], form: r.form[i], primaryDocument: r.primaryDocument[i] }));
    } else {
      try {
        rows = loadFixture<SecFiling[]>(`sec/filings-${symbol}.json`);
        isMock = true;
      } catch {
        throw new DataProviderError("AUTH_FAILED", SOURCE, "SEC_USER_AGENT missing");
      }
    }
    const retrievedAt = new Date().toISOString();
    return rows
      .filter((f) => FORMS.has(f.form) && f.filingDate >= cutoff)
      .map((f) => ({
        id: f.accessionNumber,
        symbol,
        title: `${f.form} filing`,
        type: f.form,
        filedAt: f.filingDate,
        url: cik ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accessionNumber.replace(/-/g, "")}/${f.primaryDocument}` : undefined,
        provenance: { source: SOURCE, asOf: f.filingDate, retrievedAt, isMock },
      }));
  }

  async getFinancialStatements(symbol: string): Promise<FinancialStatements> {
    const cik = await this.cik(symbol);
    const f = await this.get<Facts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    const gaap = f.facts["us-gaap"] ?? {};
    const pick = (metric: string, ...tags: string[]) => {
      for (const t of tags) {
        const rows = gaap[t]?.units.USD?.filter((r) => r.form === "10-K" || r.form === "10-Q") ?? [];
        const latest = rows.sort((a, b) => (a.end < b.end ? 1 : -1))[0];
        if (latest) return { metric, period: `FY${latest.fy} ${latest.fp}`, value: latest.val, unit: "USD" };
      }
      return undefined;
    };
    const items = [pick("Revenue", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"), pick("NetIncome", "NetIncomeLoss"), pick("OperatingIncome", "OperatingIncomeLoss")].filter((x): x is NonNullable<typeof x> => Boolean(x));
    if (!items.length) throw new DataProviderError("NOT_AVAILABLE", SOURCE, symbol);
    return { symbol, items, provenance: { source: SOURCE, asOf: items[0].period, retrievedAt: new Date().toISOString(), isMock: false } };
  }
}
