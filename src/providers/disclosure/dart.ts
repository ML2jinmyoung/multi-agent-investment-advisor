import type { Filing, FinancialStatements } from "@/domain/evidence";
import { DataProviderError } from "@/domain/portfolio";
import { loadFixture } from "@/lib/fixtures";

const SOURCE = "OpenDART";
// ponytail: static corp_code map for held KR stocks; the full list is a zip (corpCode.xml) we don't parse yet.
const CORP_CODES = loadFixture<Record<string, string>>("dart/corp-codes.json");
type DartListItem = { rcept_no: string; corp_name: string; report_nm: string; rcept_dt: string; flr_nm: string };
type DartAccount = { sj_div: string; account_nm: string; thstrm_amount: string; thstrm_dt: string; bsns_year: string };

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const toIso = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

export class DartProvider {
  readonly source = SOURCE;
  constructor(private apiKey: string | undefined) {}

  private corpCode(symbol: string) {
    const c = CORP_CODES[symbol];
    if (!c) throw new DataProviderError("NOT_AVAILABLE", SOURCE, `no corp_code for ${symbol}`);
    return c;
  }

  private async call<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.apiKey) throw new DataProviderError("AUTH_FAILED", SOURCE, "DART_API_KEY missing");
    const url = new URL(`https://opendart.fss.or.kr/api/${path}`);
    for (const [k, v] of Object.entries({ crtfc_key: this.apiKey, ...params })) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new DataProviderError("NETWORK_ERROR", SOURCE);
    }
    if (res.status === 429) throw new DataProviderError("RATE_LIMITED", SOURCE);
    if (!res.ok) throw new DataProviderError("NETWORK_ERROR", SOURCE, String(res.status));
    const j = (await res.json()) as { status: string; message?: string } & T;
    if (j.status === "013") return { list: [] } as unknown as T; // no data
    if (j.status === "010" || j.status === "011") throw new DataProviderError("AUTH_FAILED", SOURCE);
    if (j.status === "020") throw new DataProviderError("RATE_LIMITED", SOURCE);
    if (j.status !== "000") throw new DataProviderError("UNKNOWN", SOURCE, j.status);
    return j;
  }

  async getRecentFilings(symbol: string, days = 30): Promise<Filing[]> {
    const corp = this.corpCode(symbol);
    const now = new Date();
    let list: DartListItem[];
    let isMock = false;
    if (this.apiKey) {
      const end = ymd(now);
      const begin = ymd(new Date(now.getTime() - days * 86_400_000));
      list = (await this.call<{ list: DartListItem[] }>("list.json", { corp_code: corp, bgn_de: begin, end_de: end, page_count: "20" })).list ?? [];
    } else {
      // demo fallback: recorded sample, clearly marked as mock
      try {
        list = loadFixture<DartListItem[]>(`dart/filings-${symbol}.json`);
        isMock = true;
      } catch {
        throw new DataProviderError("AUTH_FAILED", SOURCE, "DART_API_KEY missing");
      }
      const cutoff = ymd(new Date(now.getTime() - days * 86_400_000));
      list = list.filter((f) => f.rcept_dt >= cutoff);
    }
    const retrievedAt = now.toISOString();
    return list.map((f) => ({
      id: f.rcept_no,
      symbol,
      title: f.report_nm,
      type: f.report_nm.replace(/\(.*$/, ""),
      filedAt: toIso(f.rcept_dt),
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${f.rcept_no}`,
      provenance: { source: SOURCE, asOf: toIso(f.rcept_dt), retrievedAt, isMock },
    }));
  }

  async getFinancialStatements(symbol: string): Promise<FinancialStatements> {
    const corp = this.corpCode(symbol);
    const year = String(new Date().getFullYear() - 1);
    const r = await this.call<{ list: DartAccount[] }>("fnlttSinglAcnt.json", { corp_code: corp, bsns_year: year, reprt_code: "11011", fs_div: "CFS" });
    const wanted = ["매출액", "영업이익", "당기순이익"];
    const items = (r.list ?? [])
      .filter((a) => wanted.includes(a.account_nm) && (a.sj_div === "IS" || a.sj_div === "CIS"))
      .map((a) => ({ metric: a.account_nm, period: `FY${a.bsns_year}`, value: Number(a.thstrm_amount.replace(/,/g, "")), unit: "KRW" }));
    if (!items.length) throw new DataProviderError("NOT_AVAILABLE", SOURCE, symbol);
    return { symbol, items, provenance: { source: SOURCE, asOf: `${year}-12-31`, retrievedAt: new Date().toISOString(), isMock: false } };
  }
}
