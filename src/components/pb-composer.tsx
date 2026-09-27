"use client";

import { ArrowUp } from "lucide-react";
import { forwardRef, useState } from "react";
import { PbOrb } from "@/components/pb-orb";
import { cn } from "@/lib/utils";

/** Floating glass composer. The orb inside "listens" while the field is focused or holds text. */
export const PbComposer = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void; onSubmit: () => void; busy: boolean }>(function PbComposer({ value, onChange, onSubmit, busy }, ref) {
  const [focused, setFocused] = useState(false);
  const listening = focused || value.length > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      data-active={listening || busy}
      className="pb-composer sticky bottom-20 z-10 mt-4"
    >
      <div className="pb-composer-shell flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-2">
        <PbOrb size={32} state={busy || listening ? "thinking" : "idle"} />
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={busy ? "PB가 분석하고 있어요…" : "PB에게 무엇이든 물어보세요"}
          aria-label="PB에게 질문"
          enterKeyHint="send"
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          aria-label="질문 보내기"
          disabled={busy || !value.trim()}
          className={cn("grid size-10 shrink-0 place-items-center rounded-full transition-all duration-300", value.trim() && !busy ? "pb-send scale-100" : "scale-90 bg-muted text-muted-foreground")}
        >
          <ArrowUp className="size-5" />
        </button>
      </div>
    </form>
  );
});
