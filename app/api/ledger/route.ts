import { z } from "zod";
import { EntrySource, LedgerError, LedgerInput } from "@/domain/ledger";
import { userIdFromRequest } from "@/lib/user-session";
import { readJson, writeGuard } from "@/lib/write-guard";
import { getLedger, listEntries, resetLedger, saveLedger } from "@/services/ledger-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userId = userIdFromRequest(req);
  const [accounts, trades] = await Promise.all([getLedger(userId), listEntries(userId)]);
  return Response.json({ accounts, trades }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.object({ ledger: LedgerInput, source: EntrySource.extract(["manual", "paste"]).default("manual") }).strict();

export async function PUT(req: Request) {
  const denied = writeGuard(req);
  if (denied) return denied;
  const body = await readJson(req, 200_000);
  if ("error" in body) return body.error;
  const parsed = Body.safeParse(body.json);
  if (!parsed.success) return Response.json({ error: "증권사 이름, 종목 코드, 양수 수량, 0 이상의 금액을 확인하세요. 한 계좌 안에서는 같은 종목을 한 줄로 합쳐 주세요." }, { status: 400 });
  try {
    await saveLedger(userIdFromRequest(req), parsed.data.ledger, parsed.data.source);
  } catch (e) {
    if (e instanceof LedgerError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const denied = writeGuard(req);
  if (denied) return denied;
  await resetLedger(userIdFromRequest(req));
  return Response.json({ ok: true });
}
