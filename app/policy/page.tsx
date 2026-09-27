import { PolicyChecks } from "@/components/policy-checks";
import { PolicyForm } from "@/components/policy-form";
import { getMetrics } from "@/services/exposure-engine";
import { checkPolicy } from "@/services/policy-engine";
import { getPolicy } from "@/services/policy-store";
import { getPortfolioSnapshot } from "@/services/portfolio-aggregator";
import { currentUserId } from "@/lib/user-session";

export const dynamic = "force-dynamic";

export default async function PolicyPage() {
  const userId = await currentUserId();
  const [policy, snap] = await Promise.all([getPolicy(userId), getPortfolioSnapshot(userId)]);
  const { metrics } = await getMetrics(snap);
  const checks = snap.valuationComplete === false ? [] : checkPolicy(metrics, metrics, policy);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">투자 원칙</h1>
        <p className="text-sm text-muted-foreground">프로필이 아니라 AI PB의 판단 기준(decision constraint)으로 사용됩니다.</p>
      </header>
      <section className="space-y-2">
        <h2 className="font-medium">현재 포트폴리오 점검</h2>
        {snap.valuationComplete === false ? <p className="text-sm text-amber-800">시세·환율을 확인하지 못해 원칙 점검을 보류했습니다. 자산 화면에서 데이터 상태를 확인하세요.</p> : <PolicyChecks checks={checks} />}
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">원칙 설정</h2>
        <PolicyForm initial={policy} />
      </section>
    </div>
  );
}
