import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The policy id is namespaced as `${userId}:default`.
export const investmentPolicies = sqliteTable("investment_policies", {
  id: text("id").primaryKey(),
  json: text("json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Per-agent provider/model override. Env vars are the defaults.
export const modelSettings = sqliteTable("model_settings", {
  agent: text("agent").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(), // plain text or AgentAnswer JSON
  runId: text("run_id"),
  createdAt: text("created_at").notNull(),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().default("demo"),
  userMessage: text("user_message").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  llmCalls: integer("llm_calls").notNull().default(0),
  decisionCalls: integer("decision_calls").notNull().default(0),
  toolCalls: integer("tool_calls").notNull().default(0),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  estimatedCost: real("estimated_cost"),
  routing: text("routing"), // JSON RoutingDecision
  answer: text("answer"), // JSON AgentAnswer
  error: text("error"),
});

export const agentSteps = sqliteTable("agent_steps", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => agentRuns.id),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // decision | llm | deterministic | skipped
  provider: text("provider"),
  model: text("model"),
  status: text("status").notNull(), // ok | error | skipped
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  parallelGroup: text("parallel_group"),
  input: text("input"), // JSON, minimal/redacted
  output: text("output"), // JSON
});

export const toolCalls = sqliteTable("tool_calls", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => agentRuns.id),
  stepId: text("step_id").references(() => agentSteps.id),
  tool: text("tool").notNull(),
  input: text("input"),
  output: text("output"),
  latencyMs: integer("latency_ms"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});

export const portfolioInputs = sqliteTable("portfolio_inputs", {
  userId: text("user_id").primaryKey(),
  json: text("json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Human / judge / code verdicts on a run, per rubric key. `labeler` is `human:<name>`, `judge:<model>` or `code`. */
export const runLabels = sqliteTable("run_labels", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => agentRuns.id),
  caseId: text("case_id"),
  rubricKey: text("rubric_key").notNull(),
  pass: integer("pass", { mode: "boolean" }).notNull(),
  labeler: text("labeler").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

/** Holdings ledger: one row per brokerage account a user keeps by hand. Never a real account number. */
export const ledgerAccounts = sqliteTable("ledger_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  broker: text("broker").notNull(),
  name: text("name").notNull().default(""),
  type: text("type").notNull().default("brokerage"),
  cashKRW: real("cash_krw").notNull().default(0),
  cashUSD: real("cash_usd").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

/** Append-only ledger entries (set | buy | sell). Positions are folded from these; undo sets `voidedAt`. */
export const ledgerEntries = sqliteTable("ledger_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  accountId: text("account_id")
    .notNull()
    .references(() => ledgerAccounts.id),
  kind: text("kind").notNull(),
  symbol: text("symbol").notNull(),
  quantity: real("quantity").notNull(),
  price: real("price"),
  fee: real("fee"),
  tradedAt: text("traded_at").notNull(), // YYYY-MM-DD
  source: text("source").notNull(), // manual | paste | chat
  createdAt: text("created_at").notNull(),
  voidedAt: text("voided_at"),
});
