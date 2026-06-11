# PartSelect Parts Assistant — Instalily Case Study

A production-deployed chat agent for the PartSelect e-commerce scenario, scoped strictly to **refrigerator** and **dishwasher** parts. The entire customer journey happens inside one chat: identity → diagnosis → part discovery → compatibility → installation guidance → cart → checkout → payment.

**Live demo:** https://customerservice.lambdapen.com
**Demo accounts:** `demo@example.com` (owns appliances, has order history) · `mike@example.com` (bought parts only — watch the appliance inference) · or continue as a guest.

---

## 1. What was built

| Area | Delivered |
|---|---|
| **Chat UI** | Next.js 16 + React 19, PartSelect branding (teal/gold), SSE streaming, rich message types: appliance cards, part cards (price / stock / compatibility badges), install-guide cards, cart drawer, address & payment forms, order confirmation |
| **Identity** | Email-or-guest at session start. Email loads purchase history; guests are lazily created and never blocked; typing a bare email mid-session switches accounts |
| **Personalization** | Owned appliances render as one-click cards; customers who only ever bought parts get appliance suggestions **inferred from part compatibility** ("Likely yours"); addresses pre-fill from the last order |
| **Diagnosis** | Self-help troubleshooting first (RAG with source links), then replacement-part recommendations as confirmable cards |
| **Commerce** | Stock-aware part cards ("Only N left" / "Out of stock"), confirm-to-add cart, order summary, demo Visa payment (Luhn-validated, **no real charges**), transactional stock decrement (oversell-proof) |
| **Self-maintenance** | Cleaning/maintenance knowledge (clogged dishwasher filter rinse, cleaner-tablet cycles, descaling, condenser-coil cleaning) with cleaning supplies sold as parts |
| **Agent** | Claude (Sonnet 4.5) on Amazon Bedrock via the Claude Agent SDK, with 9 read-only MCP tools and a fully functional no-LLM degraded mode |
| **Retrieval** | Two-tier: exact SQL for structured facts, vector RAG (Titan Embeddings v2, pgvector-ready) with automatic keyword fallback |
| **Infra** | EC2 (nginx + systemd + Let's Encrypt TLS on a custom domain), RDS PostgreSQL provisioned for migration, Bedrock for LLM + embeddings |
| **Testing** | 41 end-to-end assertions covering every flow branch, the three case-study example queries, stock edge cases, guardrails, and identity paths |

---

## 2. System architecture

```
Browser (Next.js chat UI)
   │  SSE (per turn: one client event in → stream of server events out)
   ▼
/api/chat
   ├── STATE MACHINE (deterministic, zero LLM tokens) ──────┐
   │   identity gate · fixed menus · M/P modules ·          │   both layers call the
   │   exact part/model lookups · checkout · payment        │   SAME business services
   │                                                        │
   └── AGENT LAYER (Claude Agent SDK harness) ──────────────┘
       only 3 fuzzy nodes: fault diagnosis ·
       fuzzy part matching · free-form Q&A
       9 read-only MCP tools (writes are never exposed)
              │
              ▼
   services/ (catalog · orders · users · payments)  ←  single source of truth
              │
              ▼
   SQLite (dev) / RDS PostgreSQL + pgvector (prod path)
   Amazon Bedrock: Claude Sonnet 4.5 (reasoning) · Titan Embeddings v2 (vectors)
```

---

## 3. Agent design

### 3.1 Hybrid state machine + LLM — not a pure agent

The defining decision. The conversation is modeled as an explicit state machine
([stateMachine.ts](partselect-agent/src/server/stateMachine.ts)); the LLM is invoked at exactly **three nodes** where natural-language understanding is genuinely required:

1. **Fault diagnosis** — free-text symptom → troubleshooting steps → part recommendations
2. **Fuzzy part matching** — "the bin on the door for condiments" → candidate parts (and only after a deterministic search returned nothing)
3. **Free-form Q&A** — installation follow-ups, anything the intent shortcuts can't classify

Everything else — the three-button menu, "do you know the part number?", model collection, similar-option chips, cart, address, payment — is deterministic code emitting typed UI events. Consequences:

- **Token economy:** a full purchase flow costs ~2–4k tokens instead of ~20k for a pure-agent design. The two zero-token case-study examples (install lookup, compatibility check) literally never touch the LLM.
- **Latency:** fixed steps respond in milliseconds.
- **Predictability:** checkout can't be derailed by model drift.

Deterministic intent shortcuts run before the LLM on any free text: regex extraction of part numbers (`PS\d+`) and model numbers, plus keyword routing for install / compatibility / repair / purchase intents. The pronoun in *"Is **this part** compatible with my WDT780SAEM1?"* resolves from session state (`lastPartNos`), not from the model.

### 3.2 The harness: Claude Agent SDK on Bedrock

The agent runs on the **Claude Agent SDK** (`query()`), which provides the agentic loop, MCP tool dispatch, prompt caching, and streaming. On EC2 it authenticates to **Amazon Bedrock** (`CLAUDE_CODE_USE_BEDROCK=1`), so model access rides on AWS IAM — no third-party API keys in the serving path. The model is one env var (`AGENT_MODEL`), making vendor/model swaps a config change.

Session context is injected as a **one-line profile summary** ("User appliances: … Previously purchased parts: …") instead of replaying chat history — personalization at near-zero token cost.

### 3.3 Degraded mode: the demo never breaks

Every LLM node has a deterministic fallback (keyword RAG + templated copy + symptom search). If Bedrock is unreachable, the key is missing, or the model errors mid-call, the same flows complete — cards, checkout, everything. This is also why the system was fully demoable before Bedrock model access was approved.

### 3.4 Guardrails (three independent layers)

1. **Prompt scope-pin:** the system prompt restricts the assistant to refrigerator/dishwasher parts and mandates tool use for compatibility and diagnosis claims.
2. **Read-only tools:** the LLM physically cannot mutate state — cart adds, orders, and charges exist only behind user-confirmed UI events.
3. **Deterministic facts:** compatibility answers always come from the SQL compatibility matrix; the model narrates tool results, never invents them. Out-of-scope requests (tested live: "write me a poem") get a polite refusal in both LLM and degraded modes.

---

## 4. MCP design

### 4.1 Shape

Business capability lives in four plain-TypeScript service modules — [catalog](partselect-agent/src/server/services/catalog.ts), [orders](partselect-agent/src/server/services/orders.ts), [users](partselect-agent/src/server/services/users.ts), [payments](partselect-agent/src/server/services/payments.ts). A thin layer ([mcp/index.ts](partselect-agent/src/server/mcp/index.ts)) wraps a **read-only subset** of them into an in-process MCP server via the SDK's `createSdkMcpServer` + `tool()` with zod schemas:

| Tool | Purpose |
|---|---|
| `search_parts` | symptom/description → parts, optionally scoped to a model (compatible-only) |
| `get_part_details` | part number → details, price, stock, compatible models |
| `check_compatibility` | the **only** trusted compatibility source |
| `search_repair_guides` | RAG over the troubleshooting knowledge base |
| `get_install_guide` | structured guide: difficulty/time/tools/steps/video/manual |
| `find_similar_models` | close model numbers when lookup misses |
| `get_parts_for_model` | full compatible-parts list for a model |
| `get_order_status` / `get_recent_orders` | order inquiries for the current user |

### 4.2 Design principles

- **Single source of truth.** The state machine calls service functions directly (zero tokens); the agent reaches the *same functions* through MCP. One implementation, two consumers — fixing a query fixes both paths.
- **Writes are not tools.** `addToCart`, `createOrder`, `charge` are deliberately absent from the MCP surface. This is a mechanical safety guarantee, not a prompt-level promise.
- **Token-shaped results.** Tool outputs are trimmed projections (`slimPart`) — no raw rows, no unused columns — keeping tool-result context small.
- **In-process now, remote later.** SDK MCP servers run inside the Node process today (no subprocess/network overhead). Because MCP is a wire protocol, the same tool definitions can be lifted into standalone HTTP MCP services and scaled/deployed independently — or reused by entirely different clients (an internal support dashboard, Claude Desktop for support staff) without code changes to the tools themselves.

---

## 5. Database design & schema rationale

Schema: [schema.sql](partselect-agent/src/server/db/schema.sql). SQLite in development, ANSI-compatible SQL throughout so the planned RDS PostgreSQL migration only swaps the connection module (RDS instance already provisioned, pgvector-ready).

### 5.1 Why these tables

**`parts`** — the catalog core. Notable columns:
- `stock_qty` drives the entire inventory UX: "In stock" / "Only N left" (≤5) / "Out of stock" states, add-to-cart blocking, and transactional decrement at order time. Inventory lives in the database, not in prompt text, so the LLM can never "sell" a part that isn't there.
- `symptoms` (comma-separated phrases) makes parts *discoverable by problem* ("ice maker not working") rather than only by name — it powers deterministic symptom search with zero LLM involvement, and doubles as ranking signal (symptom hits outrank name hits).
- `part_no` (PartSelect number) is the universal foreign-key-by-convention the chat uses; `mfr_part_no` mirrors how real customers cross-reference manufacturer numbers.

**`appliance_models` + `compatibility`** — a classic many-to-many junction. Compatibility is **relational data, not text**, because "does it fit?" must be answered exactly — a wrong yes is a returned order. The junction also powers reverse queries cheaply: *parts for model* (pre-order browsing) and *models for part* — which is exactly how **appliance inference** works for parts-only customers (`purchased parts → compatibility → candidate models, ranked by match count`).

**`install_guides`** — deliberately a *separate structured table*, not text chunks. Difficulty, minutes, tools, and ordered steps are facts with stable shape; storing them structured means the install branch is a **zero-token SQL lookup** rendered directly as a card. Video/manual URLs are plain columns — links are payload, not semantics, so they are never embedded.

**`doc_chunks`** — the unstructured second tier (repair guides, manual excerpts, video transcripts). Each chunk carries `symptom_tags` (retrieval signal), `source_url` + `source_ref` (page/timestamp — answers cite their sources), and an `embedding` BLOB (Float32; becomes `vector(1024)` under pgvector, where in-process cosine is replaced by the `<=>` operator). The two-tier split — *structured facts in SQL, fuzzy knowledge in vectors* — is the schema-level expression of the agent design: exact questions get exact answers, fuzzy questions get retrieval.

**`users` / `user_appliances`** — identity and the personalization loop. `user_appliances.source` is a tiny enum doing real work: `purchased` (owned — survives any update), `searched` (confirmed in a session), and inference happens at query time rather than being stored — so suggestions always reflect current compatibility data. Guests are just rows with `email = NULL`, which is why guest mode required no schema change.

**`carts` / `orders` / `order_items`** — standard commerce normalization with two deliberate choices: `order_items.unit_price` **snapshots the price at purchase time** (catalog prices change; order history must not), and order creation runs in a **single transaction** that re-validates stock, decrements it, writes the order, clears the cart, and upgrades the session appliance to `purchased` — the oversell race is closed at the database layer, not in application hope.

**`search_history`** — append-only behavioral log feeding the profile summary and future analytics (e.g., "searched a model twice but never bought" → low-confidence appliance ownership).

### 5.2 Why SQLite → PostgreSQL, and not a separate vector DB

At catalog scale (10²–10⁴ parts) a dedicated vector database adds an operational dependency for no measurable gain. pgvector keeps vectors **in the same database as the filters** — one SQL statement can combine `appliance_type = 'dishwasher' AND part_id = …` with similarity ranking. The `EmbeddingProvider` interface (Titan v2 on Bedrock in prod, optional local model offline, `none` → keyword fallback) keeps the retrieval layer swappable without touching callers.

---

## 6. Extensibility & scalability

| Change | Touch points |
|---|---|
| New appliance category (ovens) | seed data + the `appliance_type` enum — flows, tools, and UI are category-agnostic |
| New capability (returns, warranty) | one new service module + MCP tool registration |
| Real payments | replace the payments adapter (interface already shaped like a gateway) |
| Different LLM vendor/model | one env var (Agent SDK abstracts the provider) |
| Real authentication | insert a verification step (magic link / OTP) after `identifyUser` — the seam exists |
| Horizontal scale | session Map → Redis (one file); in-process MCP → standalone HTTP MCP services; SQLite → RDS (connection module swap); stateless Next.js behind a load balancer |
| Real PartSelect data | the seed script *is* the ingestion contract — point a scraper at the same arrays |

Protocol-first design helps everywhere: the typed `ClientEvent`/`ServerEvent` contract ([protocol.ts](partselect-agent/src/shared/protocol.ts)) is shared by frontend and backend, so new card types or actions are one type + one renderer + one state-machine case.

---

## 7. Conversation flow (implemented)

- **Open:** email / guest choice (guests are lazily created on first action — never blocked) → personalized appliance cards (owned, or inferred from purchased parts) → three-button menu + free-text fallback
- **Broken:** collect model (M module: not found → similar options → apology) → symptom description → troubleshooting steps with sources → part cards
- **Pre-order:** known part number → exact lookup; unknown → model + description → deterministic search first, LLM only on miss
- **Install:** part number or pick from purchased parts → structured guide card (zero tokens) → fuzzy follow-ups to the agent → "order this part too?"
- **P module everywhere:** price shown up front, user confirms before cart; low-stock and out-of-stock states; similar-part chips; apology fallback
- **Checkout:** summary confirmation → address (pre-filled) → demo Visa (4-prefix + 16 digits + Luhn) → transactional order → history feeds next session's cards

## 8. Case-study examples (all verified, see [test-flow.ts](partselect-agent/scripts/test-flow.ts))

| Query | Path | LLM? |
|---|---|---|
| "How can I install part number PS11752778?" | intent shortcut → SQL install card | No — 0 tokens |
| "Is this part compatible with my WDT780SAEM1?" | pronoun resolution → compatibility matrix → not compatible (fridge part) | No — 0 tokens |
| "The ice maker on my Whirlpool fridge is not working…" | repair intent → model collection → RAG + diagnosis → part cards | diagnosis node |
| "My dishwasher is clogged, how do I clean it?" | diagnosis → self-maintenance guide (filter rinse, cleaner cycle) + cleaning supplies as purchasable parts | diagnosis node |
| "Write me a poem" | guardrails → polite refusal | — |

## 9. Running locally

```bash
cd partselect-agent
npm install
npm run db:seed     # SQLite + seed: 18 models / 52 parts / 10 guides / 16 chunks
npm run dev         # http://localhost:3000  (fully functional with no API keys)
npm run test:flow   # 41 end-to-end assertions
```

Optional: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_USE_BEDROCK=1` for the live LLM; `EMBEDDINGS_PROVIDER=bedrock npm run embed` for vector retrieval.

## 10. Deployment (us-east-2) & next steps

EC2 t3.small (nginx → systemd-managed Next.js, Let's Encrypt TLS, Elastic IP) · Bedrock via IAM-scoped credentials · RDS PostgreSQL provisioned. Resource inventory: `DEPLOY-INFO.md`.

Known next steps: SQLite→RDS migration (async pg refactor of the service layer), verified authentication, real catalog ingestion.
