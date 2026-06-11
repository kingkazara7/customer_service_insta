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

### 5.3 What the database looks like *today* (SQLite, pre-migration)

To be precise about current state: **the system — including the production EC2 deployment — currently runs entirely on SQLite** (one WAL-mode file, `data/partselect.db`). RDS PostgreSQL is provisioned but not yet wired in (tracked as the next engineering task). The *logical* schema is identical on both engines; what changes at migration time is dialect, not design.

**Entity-relationship overview:**

```
appliance_models ──< compatibility >── parts ───1:1─── install_guides
      (18)             (938 pairs)      (664)              (13)
        │                                │ │
        │                                │ └───< doc_chunks (16; optional part link,
        │                                │        embedding BLOB → 1024-d Titan vectors)
        │                                │
        └──< user_appliances >── users   └──< order_items >── orders ──> users
                  (3)            (4 + guests)     (5)           (4)
                                   │
                                   ├──< search_history   (appended per query)
                                   └──< carts            (cleared on checkout)
```

**Current contents (seed + real-data ingest; production also accumulates guest users, searches, and live orders):**

| Table | Rows | Notes |
|---|---|---|
| `appliance_models` | 18 | 9 refrigerators + 9 dishwashers, 7 brands |
| `parts` | 664 | **~620 real parts ingested from partselect.com** — the complete catalogs of 5 fully-harvested models (real PS numbers, prices, stock, names) — plus synthetic seed incl. 2 zero-stock demo parts and 3 cleaning supplies |
| `compatibility` | 938 | part↔model pairs — the only compatibility authority |
| `install_guides` | 13 | structured: difficulty / minutes / tools / steps / links; 6 enriched with real difficulty, time, and YouTube videos from partselect.com |
| `doc_chunks` | 16 | repair + maintenance knowledge; all 16 embedded with Titan v2 (1024-d) in production |
| `users` | 4 | demo / sarah / mike / lisa sample personas (+ guests at runtime) |
| `user_appliances` | 3 | demo×2 owned, sarah×1 owned; mike/lisa intentionally empty → inference demo |
| `orders` / `order_items` | 4 / 5 | seeded purchase histories powering personalization |

**Real-data ingestion (implemented).** `npm run db:seed && npm run ingest` replays the harvested catalogs ([data/ingested/](partselect-agent/data/ingested/)) through [scripts/ingest-real.ts](partselect-agent/scripts/ingest-real.ts): the **complete parts catalogs of 5 real models** — WDT780SAEM1 (155), WRS325SDHZ01 (254), WDF520PADM7 (138), WRF555SDFZ09 (232), MDB4949SHZ (153) — paginated to the last page, ~800 listings deduplicating to ~620 unique parts. Real data overwrites synthetic data by part number; invented part numbers whose manufacturer numbers matched real parts were remapped in place (row ids preserved, so order history keeps its foreign keys) or removed when stale. Notably, partselect.com returns **HTTP 403 to plain HTTP scrapers** (verified with curl and two server-side fetchers), so the harvest runs through a real browser session using same-origin `fetch` — see §11 for why this matters.

**Is PostgreSQL "the same"?** Logically yes — tables, keys, and constraints carry over unchanged. The mechanical dialect differences that constitute the migration work:

| SQLite (today) | PostgreSQL (target) |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `GENERATED ALWAYS AS IDENTITY` |
| `TEXT DEFAULT (datetime('now'))` | `timestamptz DEFAULT now()` |
| `embedding BLOB` (Float32 LE) | `embedding vector(1024)` + HNSW index |
| cosine computed in-process (rag.ts) | `ORDER BY embedding <=> $1` in SQL |
| `COLLATE NOCASE` lookups | `citext` column type or `ILIKE` |
| `better-sqlite3` synchronous driver | `pg` async pool — the real refactor surface |

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
npm run db:seed     # SQLite + synthetic seed
npm run ingest      # merge real partselect.com data (18 models / 664 parts / 938 compat pairs total)
npm run dev         # http://localhost:3000  (fully functional with no API keys)
npm run test:flow   # 41 end-to-end assertions
```

Optional: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_USE_BEDROCK=1` for the live LLM; `EMBEDDINGS_PROVIDER=bedrock npm run embed` for vector retrieval.

## 10. Deployment (us-east-2) & next steps

EC2 t3.small (nginx → systemd-managed Next.js, Let's Encrypt TLS, Elastic IP) · Bedrock via IAM-scoped credentials · RDS PostgreSQL provisioned. Resource inventory: `DEPLOY-INFO.md`.

Known next steps: SQLite→RDS migration (async pg refactor of the service layer), verified authentication, real catalog ingestion.

---

## 11. Comparison with a public reference implementation

A well-known public attempt at this case study is [gmunhoz0810/PartSelect-LLM-Assistant](https://github.com/gmunhoz0810/PartSelect-LLM-Assistant) (GPT-4o + FastAPI, documented in the author's slide deck). Facts below come from its source code (`backend/app.py`) and the author's own slides.

**Its design in one line:** a pure agent — every query goes through GPT-4o with 4 OpenAI function-calling tools that **scrape partselect.com in real time** (BeautifulSoup over CSS selectors); SQLite is used only to log conversation history; the frontend is a non-streaming chat on GitHub Pages.

| Dimension | This project | Reference implementation |
|---|---|---|
| **Scope vs. the brief** | Information **and transactions**: cart, stock, checkout, payment, order history — the brief explicitly asks to "assist with customer transactions" | Information lookup only; author confirms no cart/checkout — buying happens on partselect.com |
| **Architecture** | Hybrid state machine + agent; LLM touched only at 3 fuzzy nodes | Pure agent; every query (even "info about PS11752778") is an LLM round-trip |
| **Cost / latency profile** | Deterministic paths: 0 tokens, milliseconds. Two of the three case-study examples never invoke the LLM | Author's own numbers: ~7 s average, 9–13 s for model queries; every query pays GPT-4o |
| **Data layer** | Owned transactional catalog: stock authority, oversell-proof orders, price snapshots | No catalog at all — author's slides: *"Very dependent on current PS website html structure"*; one CSS redesign breaks every tool |
| **Compatibility answers** | Relational matrix, exact SQL | Scraped from PS pages (accurate while the HTML holds) |
| **RAG** | Two-tier: structured SQL + vector retrieval (Titan/pgvector path) with source citations and keyword fallback | None — repair content scraped per request |
| **Identity & personalization** | Email/guest accounts, purchase history, appliance cards, **appliance inference from purchased parts**, address pre-fill | None (anonymous, capped 50-message history) |
| **UX** | SSE streaming; interactive components (part cards with stock badges, confirm-to-cart, forms) | Non-streaming text/markdown; author notes ~1% of responses render media incorrectly |
| **Resilience** | Degraded no-LLM mode completes every flow; guardrails are mechanical (read-only tools) | Hard dependency on OpenAI availability + PS HTML stability; guardrails are prompt-level |
| **Tool layer** | 9 read-only MCP tools (open standard, reusable by other clients, liftable to remote services) | 4 bespoke OpenAI function definitions; author lists "only has 4 LLM tools" as a limitation |
| **Testing** | 41 automated end-to-end assertions in CI-runnable script | Manual spot checks ("10/10 tries correct" on one query) |
| **Deployment** | Own domain + TLS on AWS (EC2/nginx/systemd), Bedrock via IAM | GitHub Pages frontend + locally-run backend (Procfile present) |

**Where the reference implementation is genuinely stronger — and our answer.** Real-time scraping gives it the *entire* live PartSelect catalog (~2M parts, fresh prices) with zero storage. That is a real advantage for breadth, and we say so plainly. But it is also a ceiling: a scraper can read pages, yet it can never hold stock authority, write an order, or guarantee compatibility after a markup change — which is why that design *cannot* satisfy the transactional half of the brief, and why its author lists HTML-dependence as his first negative.

That brittleness is no longer hypothetical: **as of 2026-06-11, partselect.com returns HTTP 403 to plain HTTP clients** (verified with curl and two independent server-side fetchers). The reference implementation's per-request scraping would not function against today's site, while this system keeps answering from its owned catalog. We closed the breadth gap from the other direction: the **ingestion contract is implemented** ([scripts/ingest-real.ts](partselect-agent/scripts/ingest-real.ts)) — the complete catalogs of 5 real models (~620 unique parts with real PartSelect numbers, prices, and stock states, plus real symptom lists, difficulty ratings, and installation videos for the hero parts) were harvested through a real browser session, which passes the bot protection that blocks HTTP scrapers, and merged into the transactional schema. Breadth *and* freshness on top of a commerce agent — not instead of one.
