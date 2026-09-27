import { cookies } from "next/headers";

export const USER_SESSION_COOKIE = "pia_session";
export const DEMO_USER_ID = "demo";

export const VALID_ID = /^[a-zA-Z0-9_-]{8,80}$/;

export function userIdFromRequest(req: Request): string {
  const raw = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${USER_SESSION_COOKIE}=([^;]+)`))?.[1];
  let value: string | undefined;
  try { value = raw && decodeURIComponent(raw); } catch { return DEMO_USER_ID; }
  return value && VALID_ID.test(value) ? value : DEMO_USER_ID;
}

export async function currentUserId(): Promise<string> {
  const value = (await cookies()).get(USER_SESSION_COOKIE)?.value;
  return value && VALID_ID.test(value) ? value : DEMO_USER_ID;
}
