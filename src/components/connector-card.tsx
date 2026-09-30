"use client";
import { useState } from "react";

/** Shown to the signed-in owner: the secret MCP URL to paste into the Claude app as a custom connector. */
export function ConnectorCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <details className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <summary className="cursor-pointer text-sm font-medium">Claude 앱에서 내 장부로 상담하기</summary>
      <p className="my-2 text-xs text-muted-foreground">Claude 앱(Pro·Max)의 설정 → 커넥터 → 커스텀 커넥터 추가에 아래 주소를 넣으면, Claude가 이 장부와 시세를 직접 읽어 답해요. 주소에 비밀 값이 들어 있으니 다른 사람에게 보내지 마세요. 비밀번호를 바꾸면 주소도 바뀌어요.</p>
      <div className="flex gap-2">
        <input aria-label="커넥터 주소" readOnly className="min-w-0 flex-1 rounded border bg-background p-2 font-mono text-xs" value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="shrink-0 rounded-full border px-4 text-sm" onClick={() => void copy()}>{copied ? "복사됨" : "복사"}</button>
      </div>
    </details>
  );
}
