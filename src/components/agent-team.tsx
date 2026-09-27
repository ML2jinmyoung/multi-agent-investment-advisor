import { Calculator, FileSearch, Route, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";

/** The specialist agents behind every answer (mirrors src/orchestration/graph.ts). */
const TEAM: { name: string; role: string; icon: LucideIcon }[] = [
  { name: "Router", role: "질문 분석", icon: Route },
  { name: "Engine", role: "노출·시뮬레이션", icon: Calculator },
  { name: "Portfolio", role: "내 자산 해석", icon: Wallet },
  { name: "Evidence", role: "공시·근거", icon: FileSearch },
  { name: "Verifier", role: "검증", icon: ShieldCheck },
];

export function AgentTeam() {
  return (
    <ul aria-label="전문 에이전트 팀" className="grid grid-cols-5 gap-1">
      {TEAM.map(({ name, role, icon: Icon }) => (
        <li key={name} className="flex flex-col items-center gap-1 text-center">
          <span className="grid size-10 place-items-center rounded-2xl bg-card text-brand shadow-sm ring-1 ring-border" aria-hidden>
            <Icon className="size-[18px]" />
          </span>
          <span className="text-[11px] font-medium leading-tight">{name}</span>
          <span className="text-[11px] leading-tight text-muted-foreground">{role}</span>
        </li>
      ))}
    </ul>
  );
}
