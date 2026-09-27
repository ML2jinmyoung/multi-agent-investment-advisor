import { PortfolioInput } from "@/domain/portfolio-input";
import { userIdFromRequest } from "@/lib/user-session";
import { getPortfolioInput, resetPortfolioInput, savePortfolioInput } from "@/services/portfolio-input-store";

export async function GET(req: Request) {
  return Response.json({ input: await getPortfolioInput(userIdFromRequest(req)) }, { headers: { "Cache-Control": "no-store" } });
}
function guard(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== (process.env.PUBLIC_APP_ORIGIN ?? new URL(req.url).origin)) return Response.json({ error: "같은 사이트에서 요청하세요." }, { status: 403 });
  if (userIdFromRequest(req) === "demo") return Response.json({ error: "쿠키를 허용하고 페이지를 다시 여세요." }, { status: 400 });
}
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = await req.text();
  if (body.length > 32_000) return Response.json({ error: "입력 크기가 너무 큽니다." }, { status: 413 });
  let json: unknown;
  try { json = JSON.parse(body); } catch { return Response.json({ error: "입력 형식이 올바르지 않습니다." }, { status: 400 }); }
  const parsed = PortfolioInput.safeParse(json);
  if (!parsed.success) return Response.json({ error: "종목 코드, 양수 수량, 0 이상의 금액을 확인하세요. 중복 없이 최대 40종목까지 입력할 수 있습니다." }, { status: 400 });
  await savePortfolioInput(userIdFromRequest(req), parsed.data);
  return Response.json({ ok: true });
}
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await resetPortfolioInput(userIdFromRequest(req));
  return Response.json({ ok: true });
}
