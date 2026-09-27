import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { PortfolioInput } from "@/domain/portfolio-input";

export async function getPortfolioInput(userId: string): Promise<PortfolioInput | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.portfolioInputs).where(eq(schema.portfolioInputs.userId, userId));
  return row ? PortfolioInput.parse(JSON.parse(row.json)) : null;
}
export async function savePortfolioInput(userId: string, input: PortfolioInput) {
  if (userId === "demo") throw new Error("개별 세션이 필요합니다.");
  const db = await getDb();
  const values = { userId, json: JSON.stringify(PortfolioInput.parse(input)), updatedAt: new Date().toISOString() };
  await db.insert(schema.portfolioInputs).values(values).onConflictDoUpdate({ target: schema.portfolioInputs.userId, set: values });
}
export async function resetPortfolioInput(userId: string) {
  const db = await getDb();
  await db.delete(schema.portfolioInputs).where(eq(schema.portfolioInputs.userId, userId));
}
