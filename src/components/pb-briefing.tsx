"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PbOrb } from "@/components/pb-orb";
import { cn } from "@/lib/utils";

type Phase = "intro" | "waiting" | "ready";

const BriefingContext = createContext<{ phase: Phase; markDataReady: () => void } | null>(null);

const GREETING = "오늘의 주요 자산 변화를 확인해볼게요";
const SEEN_KEY = "pb-briefing-seen";
const START_DELAY_MS = 450;
const CHAR_MS = 55;
const HOLD_MS = 500;

/**
 * Home intro: the PB orb appears, types a greeting, and keeps "thinking" until the
 * streamed briefing (wrapped in <BriefingReveal>) has arrived. The full intro plays
 * once per browser session; later visits (or a tap) skip the typing.
 */
export function BriefingStage({ children }: { children: ReactNode }) {
  const [typed, setTyped] = useState(0);
  const [introDone, setIntroDone] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
    if (seen || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(GREETING.length);
      setIntroDone(true);
      return;
    }
    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setTyped(i);
        if (i >= GREETING.length) {
          clearInterval(interval);
          hold = setTimeout(() => setIntroDone(true), HOLD_MS);
        }
      }, CHAR_MS);
    }, START_DELAY_MS);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
      clearTimeout(hold);
      decided.current = false;
    };
  }, []);

  const markDataReady = useCallback(() => setDataReady(true), []);
  const shown = skipped ? GREETING.length : typed;
  const phase: Phase = !(introDone || skipped) ? "intro" : !dataReady ? "waiting" : "ready";
  const ready = phase === "ready";

  return (
    <BriefingContext.Provider value={{ phase, markDataReady }}>
      <section onClick={() => setSkipped(true)} className={cn("flex flex-col items-center text-center transition-[padding] duration-700 ease-out", ready ? "pt-1" : "pt-14")}>
        <PbOrb size={ready ? 56 : 132} state={ready ? "idle" : "thinking"} className="pb-pop" />
        <p className={cn("min-h-7 font-medium transition-[margin,font-size] duration-700", ready ? "mt-3 text-base" : "mt-7 text-lg")}>
          <span className="sr-only">{GREETING}</span>
          <span aria-hidden>
            {GREETING.slice(0, shown)}
            {phase === "intro" && <span className="pb-caret" />}
          </span>
        </p>
        {phase === "waiting" && (
          <p role="status" className="pb-rise mt-1 text-sm text-muted-foreground">
            시세와 환율을 확인하고 있어요
            <span className="pb-dots" aria-hidden>
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
        )}
      </section>
      {children}
    </BriefingContext.Provider>
  );
}

/** Holds the streamed briefing back until the intro has finished, then lets it cascade in. */
export function BriefingReveal({ children }: { children: ReactNode }) {
  const ctx = useContext(BriefingContext);
  const markDataReady = ctx?.markDataReady;
  useEffect(() => markDataReady?.(), [markDataReady]);
  if (ctx && ctx.phase !== "ready") return null;
  return <div className="mt-5 space-y-3">{children}</div>;
}
