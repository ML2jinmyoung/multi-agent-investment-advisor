import { z } from "zod";
import { LedgerError, TradeInput } from "@/domain/ledger";
import { userIdFromRequest } from "@/lib/user-session";
import { readJson, writeGuard } from "@/lib/write-guard";
import { recordTrade, voidEntry } from "@/services/ledger-store";

export const dynamic = "force-dynamic";

const Body = z.object({ trade: TradeInput, dryRun: z.boolean().default(false) }).strict();

/** Records a confirmed trade, or with dryRun returns the before/after holding without saving. */
export async function POST(req: Request) {
  const denied = writeGuard(req);
  if (denied) return denied;
  const body = await readJson(req, 4_000);
  if ("error" in body) return body.error;
  const parsed = Body.safeParse(body.json);
  if (!parsed.success) return Response.json({ error: "계좌, 종목 코드, 양수 수량, 0 이상의 단가, 날짜를 확인하세요." }, { status: 400 });
  try {
    return Response.json(await recordTrade(userIdFromRequest(req), parsed.data.trade, { dryRun: parsed.data.dryRun }));
  } catch (e) {
    if (e instanceof LedgerError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

/** Undo: DELETE /api/ledger/trades?id=<entry id> */
export async function DELETE(req: Request) {
  const denied = writeGuard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) return Response.json({ error: "거래 id가 필요합니다." }, { status: 400 });
  try {
    await voidEntry(userIdFromRequest(req), id);
  } catch (e) {
    if (e instanceof LedgerError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return Response.json({ ok: true });
}
