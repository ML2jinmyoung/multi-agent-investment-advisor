"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Owner sign-in on this device: one passcode per device, then every device shares the same ledger. */
export function OwnerLogin({ owner }: { owner: boolean }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/owner", { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify({ passcode }) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPasscode("");
      setMessage(method === "DELETE" ? "이 기기에서 로그아웃했어요." : data.adopted ? "로그인했어요. 이 기기에서 입력한 장부를 내 장부로 옮겼어요." : "로그인했어요.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (owner) {
    return (
      <p className="flex items-center justify-between rounded-2xl bg-card px-4 py-3 text-sm shadow-sm ring-1 ring-border">
        <span>내 장부로 로그인됨 · 모든 기기에서 같은 장부</span>
        <button type="button" className="text-xs underline" disabled={busy} onClick={() => void call("DELETE")}>로그아웃</button>
      </p>
    );
  }
  return (
    <form className="space-y-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border" onSubmit={(e) => { e.preventDefault(); void call("POST"); }}>
      <p className="text-sm font-medium">내 장부로 로그인</p>
      <p className="text-xs text-muted-foreground">소유자 비밀번호를 기기마다 한 번 입력하면 휴대폰·컴퓨터에서 같은 장부를 봐요.</p>
      <div className="flex gap-2">
        <input aria-label="소유자 비밀번호" type="password" autoComplete="current-password" required maxLength={200} className="min-w-0 flex-1 rounded border bg-background p-2 text-sm" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        <button className="shrink-0 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground" disabled={busy || !passcode}>{busy ? "확인 중…" : "로그인"}</button>
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>
  );
}
