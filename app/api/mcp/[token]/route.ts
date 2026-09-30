import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isMcpToken, OWNER_USER_ID } from "@/lib/owner-auth";
import { createOwnerMcpServer } from "@/mcp/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Streamable HTTP MCP endpoint for the Claude app connector. The secret token in the path (derived from
 * OWNER_PASSCODE, shown on /assets after login) is the whole authentication: a wrong one is a 404, like any
 * unknown path. Stateless: each request gets a fresh server, so nothing is kept between calls.
 */
async function handle(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!isMcpToken((await ctx.params).token)) return new Response(null, { status: 404 });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 64_000 });
  const server = createOwnerMcpServer(OWNER_USER_ID);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // the response body is already materialized (JSON mode), so nothing is cut off
    void server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
