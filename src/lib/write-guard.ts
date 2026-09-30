import { userIdFromRequest } from "./user-session";

/** Same-site writes from a visitor with their own session cookie; returns an error response otherwise. */
export function writeGuard(req: Request): Response | undefined {
  const origin = req.headers.get("origin");
  if (origin && origin !== (process.env.PUBLIC_APP_ORIGIN ?? new URL(req.url).origin)) return Response.json({ error: "같은 사이트에서 요청하세요." }, { status: 403 });
  if (userIdFromRequest(req) === "demo") return Response.json({ error: "쿠키를 허용하고 페이지를 다시 여세요." }, { status: 400 });
}

/** Parses a bounded JSON body; returns an error response when too large or malformed. */
export async function readJson(req: Request, maxBytes: number): Promise<{ json: unknown } | { error: Response }> {
  const body = await req.text();
  if (body.length > maxBytes) return { error: Response.json({ error: "입력 크기가 너무 큽니다." }, { status: 413 }) };
  try {
    return { json: JSON.parse(body) };
  } catch {
    return { error: Response.json({ error: "입력 형식이 올바르지 않습니다." }, { status: 400 }) };
  }
}
