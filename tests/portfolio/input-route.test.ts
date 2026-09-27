import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PUT, DELETE } from "../../app/api/portfolio/input/route";
import { getPortfolioInput, resetPortfolioInput } from "@/services/portfolio-input-store";
afterEach(() => vi.unstubAllEnvs());
const payload = { holdings: [{ symbol: "NVDA", quantity: 2 }], cashKRW: 0, cashUSD: 0 };
function request(id: string, origin: string, method = "PUT") {
  return new Request("http://0.0.0.0:3000/api/portfolio/input", { method, headers: { cookie: `pia_session=${id}`, origin, "Content-Type": "application/json" }, body: method === "PUT" ? JSON.stringify(payload) : undefined });
}
describe("portfolio input behind Fly TLS proxy", () => {
  it("accepts the configured public origin and persists/resets the caller's holdings", async () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://demo.example");
    const id = randomUUID();
    try {
      expect((await PUT(request(id, "https://demo.example"))).status).toBe(200);
      expect(await getPortfolioInput(id)).toEqual(payload);
      expect((await DELETE(request(id, "https://demo.example", "DELETE"))).status).toBe(200);
      expect(await getPortfolioInput(id)).toBeNull();
    } finally { await resetPortfolioInput(id); }
  });
  it("rejects writes from another origin", async () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://demo.example");
    const id = randomUUID();
    expect((await PUT(request(id, "https://other.example"))).status).toBe(403);
    expect(await getPortfolioInput(id)).toBeNull();
  });
});
