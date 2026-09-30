import { PortfolioInput } from "@/domain/portfolio-input";
import { userIdFromRequest } from "@/lib/user-session";
import { readJson, writeGuard } from "@/lib/write-guard";
import { getPortfolioInput, resetPortfolioInput, savePortfolioInput } from "@/services/portfolio-input-store";

export async function GET(req: Request) {
  return Response.json({ input: await getPortfolioInput(userIdFromRequest(req)) }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(req: Request) {
  const denied = writeGuard(req);
  if (denied) return denied;
  const body = await readJson(req, 32_000);
  if ("error" in body) return body.error;
  const parsed = PortfolioInput.safeParse(body.json);
  if (!parsed.success) return Response.json({ error: "종목 코드, 양수 수량, 0 이상의 금액을 확인하세요. 중복 없이 최대 40종목까지 입력할 수 있습니다." }, { status: 400 });
  await savePortfolioInput(userIdFromRequest(req), parsed.data);
  return Response.json({ ok: true });
}
export async function DELETE(req: Request) {
  const denied = writeGuard(req);
  if (denied) return denied;
  await resetPortfolioInput(userIdFromRequest(req));
  return Response.json({ ok: true });
}
