import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Siri-style animated orb that represents the AI PB. Pure CSS (see `.pb-orb` in globals.css). */
export function PbOrb({ size = 40, state = "idle", className }: { size?: number; state?: "idle" | "thinking"; className?: string }) {
  return (
    <div aria-hidden className={cn("pb-orb", className)} data-state={state} style={{ width: size, height: size, "--orb-blur": `${Math.max(3, Math.round(size / 10))}px` } as CSSProperties}>
      <span className="pb-orb-blob pb-orb-a" />
      <span className="pb-orb-blob pb-orb-b" />
      <span className="pb-orb-blob pb-orb-c" />
      <span className="pb-orb-core" />
    </div>
  );
}
