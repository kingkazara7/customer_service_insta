# PartSelect Parts Assistant

A production-deployed chat agent for the PartSelect e-commerce scenario, scoped strictly to **refrigerator** and **dishwasher** parts. The whole customer journey happens inside one chat: identity → (optional photo) → diagnosis or part discovery → compatibility → installation guidance → cart → checkout → payment.

**Live demo:** https://customerservice.lambdapen.com
**Try:** `demo@example.com` (owns appliances + order history) · `mike@example.com` (bought parts only — watch the appliance inference) · or **Continue as guest** · or tap **📷** and upload a model-sticker photo.

---

## Table of contents

1. [What's included](#1-whats-included)
2. [Architecture](#2-architecture)
3. [The state machine](#3-the-state-machine)
4. [How each feature is implemented](#4-how-each-feature-is-implemented)
5. [Database schema](#5-database-schema)
6. [Repository layout](#6-repository-layout)
7. [Running it](#7-running-it)
8. [Deployment](#8-deployment)

---

## 1. What's included

| Capability | Summary |
|---|---|
| **Branded chat UI** | Next.js 16 + React 19, PartSelect teal/gold, SSE streaming, rich interactive message types (cards, chips, forms) |
| **Identity (email or guest)** | Email loads purchase history; guests work fully and are created lazily; a bare email mid-chat switches accounts |
| **Personalization** | Owned appliances as one-click cards; for parts-only buyers, the likely appliance is **inferred from part compatibility**; addresses pre-fill from the last order |
| **Vision input 📷** | Upload a photo of the **model nameplate** (reads the model number) or a **broken part** (identifies it) → routes into the flow; non-appliance photos are refused |
| **Fault diagnosis** | Self-help troubleshooting first (RAG with source links), then replacement-part recommendations as confirmable cards |
| **Part lookup & search** | By exact PartSelect number, by symptom, or by natural-language description; scoped to a model when known |
| **Compatibility check** | Exact answer from a relational part↔model matrix — never guessed |
| **Installation guidance** | Structured guide card (difficulty / time / tools / steps / video / manual), zero-token SQL lookup; fuzzy follow-ups go to the LLM |
| **Commerce** | Stock-aware part cards ("Only N left" / "Out of stock"), confirm-to-add cart, order summary, address form, **demo Visa payment** (Luhn-validated, no real charges), transactional order with oversell-proof stock decrement |
| **Self-maintenance** | Cleaning/descaling/coil-cleaning knowledge with cleaning supplies sold as parts |
| **Live fallback** | On a catalog miss, fetch the part/model from partselect.com, parse it, and **ingest it** (self-growing catalog); proxy-ready, off by default |
| **Agent** | Claude (Sonnet 4.5) on Amazon Bedrock via the Claude Agent SDK; invoked only at 3 fuzzy nodes; **fully functional no-LLM degraded mode** |
| **MCP tools** | 9 read-only tools (open standard, reusable/remoteable) |
| **Two-tier retrieval** | Exact SQL for facts + vector RAG (Titan Embeddings v2, pgvector-ready) with automatic keyword fallback |
| **Real catalog data** | ~620 real parts ingested from partselect.com (real PS numbers, prices, stock, symptoms, videos) |
| **Scope guardrails** | Three layers keep the agent on refrigerator/dishwasher parts only |
| **Tests** | 43 automated end-to-end assertions |
| **Deployment** | EC2 + nginx + systemd + Let's Encrypt TLS on a custom domain; Bedrock via IAM |

---

## 2. Architecture

```
Browser — Next.js chat UI (cards, chips, forms, 📷 upload)
   │  SSE: one ClientEvent in → a stream of ServerEvents out
   ▼
/api/chat  (Next.js route, Node runtime)
   │
   ▼
STATE MACHINE  (stateMachine.ts — deterministic, zero LLM tokens)
   identity gate · menus · M-module (model) · P-module (parts) ·
   install · cart · checkout · payment · intent shortcuts
   │                                   │
   │ calls directly                    │ wraps the same functions as
   ▼                                   ▼ read-only MCP tools
SERVICES  (catalog · orders · users · payments)  ◄── single source of truth
   │
   ├── AGENT LAYER (agent/index.ts) — only 3 fuzzy nodes:
   │     diagnosis · fuzzy part match · free-form Q&A
   │     Claude Agent SDK → Bedrock; degrades to keyword RAG + templates
   ├── VISION (vision.ts) — Bedrock Converse, image → model/part
   ├── RAG (rag.ts) — vector (Titan) first, keyword fallback
   └── LIVE FETCH (liveFetch.ts) — catalog miss → fetch+ingest (proxy-ready)
   │
   ▼
SQLite (dev & current prod)  /  RDS PostgreSQL + pgvector (migration target)
Amazon Bedrock: Claude Sonnet 4.5 (reasoning + vision) · Titan Embeddings v2
```

**The one design decision that shapes everything:** the conversation is an explicit **state machine**, and the **LLM is invoked only where natural language genuinely needs interpreting** — three nodes. Everything else (menus, "know the part number?", model collection, cart, address, payment) is deterministic code emitting typed UI events. Result: a full purchase flow costs ~2–4k tokens instead of ~20k for a pure-agent design, fixed steps respond in milliseconds, and checkout can't be derailed by model drift. The state machine and the agent call the **same service functions** — one source of truth, two callers.

---

## 3. The state machine

Stages (`Session.stage` in [session.ts](partselect-agent/src/server/session.ts)) and the transitions between them. `⓪` = zero LLM tokens, `Ⓛ` = LLM node, `Ⓥ` = vision (Bedrock).

```
                          ┌─────────────┐
   init / submit_image ──►│ await_email │  email → load account & history ⓪Ⓓ
   (any action lazily     └──────┬──────┘  guest → new account; bare email → switch
    promotes to guest)           │
                                 ▼
                          ┌─────────────┐   appliance cards (owned / inferred) +
                          │    menu     │◄── 3-button menu + free-text + 📷  ⓪
                          └──┬───┬───┬──┘
        ┌────────────────────┘   │   └────────────────────┐
   "broken"               "preorder"                 "install"
        │                       │                          │
        ▼                       ▼                          ▼
 need model? ──┐      know part number? ◆           ┌─ pick purchased part ⓪
        │ no   │ yes      yes │      │ no            └─ or type part no
        ▼      │              ▼      ▼                      │
 ┌────────────┐│      ┌────────────┐ need model            ▼
 │await_model ││      │await_partno│     │           ┌──────────────┐
 └─────┬──────┘│      └─────┬──────┘     ▼           │ install_pick │
       │ ⟦M⟧   │            │ ⟦P⟧  ┌──────────────┐  └──────┬───────┘
       ▼       │            ▼      │await_part_desc│         ▼  ⟦P⟧
 ┌──────────────┐    ┌────────────┐└──────┬───────┘  install_card ⓪Ⓓ
 │await_fault_  │    │ part cards │       │ ⓪→Ⓛ            │
 │   desc       │    │ ⟦P module⟧ │       ▼                ▼
 └──────┬───────┘    └─────┬──────┘  part cards ⟦P⟧  ┌────────────┐
        ▼ Ⓛ+RAG            │                          │ install_qa │ Ⓛ
 self-help steps +         │                          └─────┬──────┘
 part cards ⟦P⟧            │                                │ "order it?"
        └──────────────────┴──────────────┬───────────────┘
                                           ▼
                              [ Add to Cart ] (confirm-to-add) ⓪
                                           ▼
                                  ┌─────────────────┐
                                  │ awaiting_confirm│ order summary ⓪
                                  └────────┬────────┘
                                           ▼ yes
                                  ┌─────────────────┐
                                  │  await_address  │ form (pre-filled) ⓪
                                  └────────┬────────┘
                                           ▼
                                  ┌─────────────────┐
                                  │  await_payment  │ demo Visa (Luhn) ⓪
                                  └────────┬────────┘
                                           ▼ transaction: order + stock−− ⓪Ⓓ
                                    order confirmed → back to menu
```

**⟦M module⟧ (model lookup):** found → continue by intent · not found → (live fetch if enabled) → similar-model chips → "none of these" → apology → menu.
**⟦P module⟧ (part + stock):** in stock → card with price + "Add to Cart" · low stock → "Only N left" · out of stock → notice + alternatives · not found → (live fetch if enabled) → similar-part chips → apology.

**Vision and free-text are entry shortcuts**, not separate stages: a photo (`submit_image`) or a free-text message is classified and routed *into* the stages above — e.g. a nameplate photo jumps to ⟦M⟧, "How do I install PS11752778?" jumps straight to `install_card`, "ice maker not working" enters the broken branch.

---

## 4. How each feature is implemented

### 4.1 Chat transport & UI
- **SSE per turn** ([api/chat/route.ts](partselect-agent/src/app/api/chat/route.ts)): one `ClientEvent` POSTed in; the handler streams `ServerEvent`s as `data:` frames. The session id is issued via the `x-session-id` header and echoed back by the client.
- **Typed protocol** ([protocol.ts](partselect-agent/src/shared/protocol.ts)) shared by both ends — `ClientEvent` (user actions) and `ServerEvent` (`text`, `agent_delta`, `appliance_cards`, `part_cards`, `install_card`, `cart`, `order_summary`, `address_form`, `payment_form`, `email_form`, …). New UI = one type + one renderer ([Cards.tsx](partselect-agent/src/components/Cards.tsx)) + one state-machine case.
- **Streaming text** merges `agent_delta` frames into one growing bubble ([Chat.tsx](partselect-agent/src/components/Chat.tsx)).

### 4.2 Identity (email or guest)
- `getOrCreateUserByEmail` and `createGuestUser` in [users.ts](partselect-agent/src/server/services/users.ts). A session starts with `userId = 0` (unidentified).
- The state-machine guard ([stateMachine.ts](partselect-agent/src/server/stateMachine.ts)) **lazily promotes** any action by an unidentified user to a guest account — nothing is ever blocked. Email loads the account; an unknown email creates one ("Welcome / Account created"); typing a bare email mid-chat switches accounts.
- Guests are just rows with `email = NULL`, so guest mode needed no schema change.

### 4.3 Personalization & appliance inference
- `getAppliances` renders owned/searched machines as cards.
- For customers who bought parts but never registered a machine, `inferModelsFromPurchases` runs `purchased parts → compatibility → candidate models, ranked by match count`, surfaced as "Likely yours" cards.
- `profileSummary` injects a **one-line** profile into the agent context instead of replaying chat history — personalization at near-zero token cost.

### 4.4 Vision input 📷
- [vision.ts](partselect-agent/src/server/vision.ts): the client downscales the image to ≤1024px JPEG, then `handleImage` calls **Bedrock Converse** with an image content block. The model returns exactly one line — `MODEL: <no>`, `PART: <desc> | <appliance>`, or `UNCLEAR: <reason>` — which routes into ⟦M module⟧ or part search.
- The scope guardrail extends to images: a non-appliance photo returns `UNCLEAR`. No LLM → graceful "please type your model number".

### 4.5 Diagnosis (broken branch)
- `agentDiagnose` ([agent/index.ts](partselect-agent/src/server/agent/index.ts)): calls `search_repair_guides` (RAG) for self-help steps first, then `search_parts` (scoped to the model) and emits a `RECOMMEND:` line of part numbers the state machine renders as cards.
- **Degraded mode:** with no LLM, it falls back to keyword RAG (`retrieveChunks`) + symptom search and templated copy — every branch still completes.

### 4.6 Part lookup, search & compatibility
- `getPartByNo`, `searchParts` (symptom-weighted, optional model scope), `checkCompatibility` in [catalog.ts](partselect-agent/src/server/services/catalog.ts).
- **Compatibility is relational, never guessed** — it reads the `compatibility` junction table. A wrong "yes" is a returned order, so this is the one thing the LLM may not improvise (enforced by the system prompt and by `check_compatibility` being the only compatibility tool).
- Misses produce close matches via prefix-shrinking (`findSimilarModels` / `findSimilarParts`).

### 4.7 Installation guidance
- `getInstallGuide` returns a structured row (difficulty, minutes, tools, ordered steps, video, manual). The install branch renders it as a card with a **zero-token SQL lookup**; only fuzzy follow-ups ("do I need to shut off the water?") reach the agent.

### 4.8 Commerce (cart → checkout → payment)
- [orders.ts](partselect-agent/src/server/services/orders.ts): `addToCart` enforces stock; `createOrder` runs a **single transaction** — re-validate stock → decrement → write order + items (with `unit_price` snapshotted) → clear cart → upgrade the session model to "owned". The oversell race is closed at the DB layer.
- [payments.ts](partselect-agent/src/server/services/payments.ts): **demo-only** `validateVisa` (starts with 4, 16 digits, Luhn) + `charge` returning a fake receipt — **no real gateway, no real charges**. Shaped like a gateway adapter so swapping in Stripe is a one-file change.
- Stock states drive the UI: `lowStock` (≤5 → "Only N left"), `outOfStock` (blocks add), in-stock badge.

### 4.9 Self-maintenance knowledge
- Repair/maintenance `doc_chunks` (clogged-dishwasher filter rinse, descaling, condenser-coil cleaning, odor) plus cleaning supplies (affresh tablets, descaler, coil brush) seeded as real purchasable parts — so "how do I clean it?" yields both the procedure and the products.

### 4.10 Live fallback & self-growing catalog
- [liveFetch.ts](partselect-agent/src/server/liveFetch.ts): on a catalog miss, `tryLiveModel` / `tryLivePart` fetch the live page with a real browser engine (Playwright), parse it with the **same logic that harvested the 620-part catalog**, and `ingestLivePart` / `ensureModel` write it into the catalog — then the answer comes from the now-present row.
- **Operational reality (documented):** partselect.com returns **HTTP 403 to datacenter IPs** — verified that even a real headless Chromium from EC2 gets "Access Denied". So a reliable live fetch needs a residential egress (`SCRAPE_PROXY_URL`). The feature is off by default (`LIVE_FETCH=1`) and degrades cleanly to the catalog answer when blocked; the *owned* catalog is what makes the system robust regardless.

### 4.11 Agent layer & MCP tools
- The agent ([agent/index.ts](partselect-agent/src/server/agent/index.ts)) runs the **Claude Agent SDK** (`query()`) on **Bedrock** (`CLAUDE_CODE_USE_BEDROCK=1`, model via `AGENT_MODEL`), so model access rides on AWS IAM — no third-party keys in the serving path.
- **9 read-only MCP tools** ([mcp/index.ts](partselect-agent/src/server/mcp/index.ts)): `search_parts`, `get_part_details`, `check_compatibility`, `search_repair_guides`, `get_install_guide`, `find_similar_models`, `get_parts_for_model`, `get_order_status`, `get_recent_orders`. Write operations (cart, order, charge) are **deliberately not tools** — a mechanical safety guarantee, not a prompt promise. Results are trimmed projections to keep context small.

### 4.12 Two-tier retrieval (RAG)
- [rag.ts](partselect-agent/src/server/rag.ts): when vectors exist it does cosine-similarity retrieval over `doc_chunks`; otherwise it falls back to keyword search — callers never notice.
- [embeddings/provider.ts](partselect-agent/src/server/embeddings/provider.ts): a swappable `EmbeddingProvider` — **Bedrock Titan v2** (1024-dim) in prod, an optional local model offline, or `none` → keyword fallback. `npm run embed` populates the vectors.

### 4.13 Scope guardrails (three layers)
1. **Prompt scope-pin** — the system prompt restricts the agent to refrigerator/dishwasher parts and mandates tool use for compatibility/diagnosis.
2. **Read-only tools** — the LLM physically cannot mutate state.
3. **Deterministic facts** — compatibility comes from SQL; the model narrates tool results, never invents them. Out-of-scope text *and* non-appliance photos are refused, in both LLM and degraded modes.

### 4.14 Real-data ingestion
- [scripts/ingest-real.ts](partselect-agent/scripts/ingest-real.ts) replays [data/ingested/](partselect-agent/data/ingested/) — the complete parts catalogs of 5 real models harvested through a real browser session — and upserts them by part number. Invented seed numbers whose manufacturer numbers matched real parts are remapped in place (row ids preserved, so order history keeps its foreign keys).

---

## 5. Database schema

SQLite in dev and current prod; ANSI-compatible SQL throughout so the RDS PostgreSQL migration only swaps the connection module (instance provisioned, pgvector-ready). Schema: [schema.sql](partselect-agent/src/server/db/schema.sql).

```
appliance_models ──< compatibility >── parts ───1:1─── install_guides
      (18)             (938 pairs)      (664)              (13)
        │                                │ │
        │                                │ └───< doc_chunks (16; optional part link,
        │                                │        embedding BLOB → 1024-d Titan vector)
        │                                │
        └──< user_appliances >── users   └──< order_items >── orders ──> users
                  (3)            (4 + guests)     (5)           (4)
                                   │
                                   ├──< search_history   (appended per query)
                                   └──< carts            (cleared on checkout)
```

Why these tables work the way they do:
- **`parts.stock_qty`** drives the entire inventory UX and the transactional decrement — inventory lives in the DB, not in prompt text, so the LLM can't "sell" what isn't there. **`parts.symptoms`** makes parts discoverable by problem and doubles as ranking signal.
- **`compatibility`** is a many-to-many junction because "does it fit?" must be exact; the same table powers reverse queries (`parts for model`, and the appliance inference for parts-only buyers).
- **`install_guides`** is a separate *structured* table (not text) so the install card is a zero-token SQL lookup; video/manual URLs are payload, not embedded.
- **`doc_chunks`** is the unstructured tier — `symptom_tags`, `source_url`+`source_ref` (cited in answers), and an `embedding` BLOB (becomes `vector(1024)` under pgvector). Structured facts in SQL + fuzzy knowledge in vectors is the schema-level mirror of the agent design.
- **`order_items.unit_price`** snapshots the price at purchase time; order creation is one transaction (re-check stock → decrement → write → clear cart) so overselling is closed at the DB layer.

---

## 6. Repository layout

```
partselect-agent/
├── src/app/                # Next.js pages + /api/chat SSE route
├── src/components/         # Chat.tsx + Cards.tsx (all message types)
├── src/shared/protocol.ts  # typed ClientEvent / ServerEvent contract
├── src/server/
│   ├── stateMachine.ts     # deterministic flow core (M/P modules, intents, checkout)
│   ├── session.ts          # session state (in-memory Map; Redis-ready)
│   ├── vision.ts           # Bedrock Converse image → model/part
│   ├── liveFetch.ts        # catalog-miss live fetch (Playwright, proxy-ready)
│   ├── rag.ts              # vector-first, keyword-fallback retrieval
│   ├── agent/              # Claude Agent SDK + degraded mode + scope guard
│   ├── mcp/                # 9 read-only MCP tools
│   ├── services/           # catalog · orders · users · payments (source of truth)
│   ├── embeddings/         # Bedrock Titan / local provider abstraction
│   └── db/                 # schema.sql + seed.ts
├── scripts/                # seed · ingest-real · embed · test-flow (43 assertions)
└── data/ingested/          # harvested real partselect.com catalog
```

---

## 7. Running it

```bash
cd partselect-agent
npm install
npm run db:seed     # SQLite + synthetic seed
npm run ingest      # merge real partselect.com data → 18 models / 664 parts / 938 compat
npm run dev         # http://localhost:3000  (fully functional with NO API keys)
npm run test:flow   # 43 end-to-end assertions
```

Optional capabilities via env:
- `ANTHROPIC_API_KEY` **or** `CLAUDE_CODE_USE_BEDROCK=1` (+ `AGENT_MODEL`) → live Claude reasoning & vision.
- `EMBEDDINGS_PROVIDER=bedrock npm run embed` → vector RAG with Titan.
- `LIVE_FETCH=1` (+ `SCRAPE_PROXY_URL` for a residential proxy) → live fallback fetch.

With no keys at all, the app still runs end-to-end in degraded mode (keyword RAG + templates).

---

## 8. Deployment

Live at **https://customerservice.lambdapen.com**: EC2 t3.small running the Next.js server under **systemd**, behind **nginx** (SSE buffering off) with a **Let's Encrypt** certificate, on an Elastic IP; **Bedrock** (Claude Sonnet 4.5 + Titan v2) via IAM-scoped credentials; **RDS PostgreSQL** provisioned for the migration. Resource inventory: `DEPLOY-INFO.md`. Deploy = `db:seed → ingest → embed → systemctl restart partselect`.

**Next step:** SQLite → RDS migration (async `pg` refactor of the service layer + pgvector for `doc_chunks`).
