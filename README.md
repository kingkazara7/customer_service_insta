# PartSelect Parts Assistant — Instalily Case Study

A chat agent for the PartSelect e-commerce scenario, scoped to **refrigerator** and **dishwasher** parts: fault diagnosis, part lookup, compatibility checks, installation guidance, and checkout — the entire journey happens inside the chat.

**Live demo:** https://customerservice.lambdapen.com

## Architecture

```
Browser (Next.js chat UI, PartSelect branding)
   │  SSE (per turn: event in → event stream out)
   ▼
/api/chat
   ├── State machine (deterministic flow, zero LLM tokens) ──┐
   │    button branches / forms / exact part & model lookups  │  share one set of
   │                                                          │  business services
   └── Agent layer (Claude Agent SDK harness) ────────────────┘  (MCP tools)
        only 3 fuzzy nodes: diagnosis / fuzzy part match / free-form Q&A
        9 read-only MCP tools (write operations are never exposed to the LLM)
              │
              ▼
   SQLite (dev) / RDS PostgreSQL + pgvector (production)
   Amazon Bedrock: Claude (chat) + Titan Embeddings v2 (vectors)
```

### Core design decisions

1. **State machine + LLM hybrid, not a pure agent.** Fixed questions (broken / pre-order / install), the "do you know the part number?" fork, address and payment forms are all handled by the state machine and UI components — **0 tokens**. Only the three nodes that genuinely require natural-language understanding invoke the LLM. A full purchase flow drops from ~20k tokens (pure-agent design) to ~2–4k; with no LLM configured the system degrades to keyword retrieval + templates and still completes every flow.
2. **Business logic is written once.** Four service groups (catalog / orders / users / payments) are called directly by the state machine *and* wrapped as MCP tools for the agent — a single source of truth.
3. **The LLM is read-only.** Adding to cart, placing orders, and charging cards can only be triggered by explicit user button clicks; compatibility answers always come from the compatibility matrix in SQL, never from model memory.
4. **Personalization that saves tokens.** The user's appliances and purchase history are stored and rendered as clickable cards on open (one click injects the model number, saving 2–4 clarification turns); the agent receives a one-line profile summary instead of replayed conversation history.

## Conversation flow (v2, implemented)

- Opening: appliance-history cards + three-button menu (🔧 My appliance is broken / 🛒 Order a replacement part / 📦 How to install my part) + free-text fallback
- **Broken branch:** collect model (M module) → fault description → self-help troubleshooting first (RAG with sources) → recommended part cards
- **Pre-order branch:** know the part number? → yes: exact lookup; no: collect model + description → deterministic search first, LLM only if it finds nothing
- **Install branch:** part number (or pick from previously purchased parts) → structured install card (difficulty / time / tools / steps / video / manual — straight SQL, zero tokens) → fuzzy follow-ups go to the LLM → offers to order the part
- **M module:** model not found → "We couldn't find model …" + similar-model options → none picked → "Sorry, we couldn't find the part you're looking for." → back to menu
- **P module:** cards show the price up front (with "Only N left" low-stock hints); parts are added to the cart only after the user confirms; zero stock → "out of stock" notice + in-stock alternatives; not found → similar parts → apology
- **Checkout:** order summary confirmation → address form (pre-filled from history) → demo payment (a Visa number starting with 4, 16 digits, passing Luhn succeeds — **no real charges**) → order + stock decrement in one transaction (prevents overselling) → the purchase feeds back into the appliance cards (closed loop)

## Repository layout

```
partselect-agent/
├── src/app/                # Next.js pages + /api/chat SSE route
├── src/components/         # Chat UI: appliance/part/install cards, forms, cart drawer
├── src/shared/protocol.ts  # Event protocol shared by frontend and backend
├── src/server/
│   ├── stateMachine.ts     # Deterministic flow core (M/P modules, intent shortcuts, checkout)
│   ├── session.ts          # Session state (in-memory Map; swap for Redis in production)
│   ├── agent/              # Claude Agent SDK integration + degraded path + scope guardrail
│   ├── mcp/                # 9 read-only MCP tools (createSdkMcpServer)
│   ├── services/           # catalog / orders / users / payments (single source of truth)
│   ├── rag.ts              # Vector retrieval first, automatic keyword fallback
│   ├── embeddings/         # Bedrock Titan v2 / local model provider abstraction
│   └── db/                 # schema.sql + seed data (28 parts / 12 models / 8 guides / 10 doc chunks)
└── scripts/                # seed / embed / test-flow (28 end-to-end assertions)
```

## Running locally

```bash
cd partselect-agent
npm install
npm run db:seed        # initialize SQLite + seed data
npm run dev            # http://localhost:3000
npm run test:flow      # 28 end-to-end assertions (incl. the three case-study examples)
```

The full demo works with no API keys (degraded mode). To enable the live LLM: set `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_USE_BEDROCK=1` on EC2. To enable vector retrieval: `EMBEDDINGS_PROVIDER=bedrock npm run embed`.

## Case-study example coverage (scripts/test-flow.ts)

| Example | Path | LLM? |
|---|---|---|
| How can I install part number PS11752778? | intent shortcut → SQL install-guide card | No (0 tokens) |
| Is this part compatible with my WDT780SAEM1? | pronoun resolution → compatibility matrix → ❌ not compatible (it's a fridge part) | No (0 tokens) |
| Ice maker not working, how can I fix it? | repair intent → collect model → RAG troubleshooting + part cards | diagnosis node |
| Out-of-scope (poems, etc.) | two-layer guardrail → polite refusal | — |

## AWS deployment (us-east-2)

See `DEPLOY-INFO.md` for the resource inventory: EC2 t3.small (instalily_project) behind nginx with Let's Encrypt TLS at customerservice.lambdapen.com, RDS PostgreSQL (instalily-db, pgvector-ready), Bedrock (Claude + Titan). Production evolution: SQLite→RDS (service-layer SQL stays ANSI-compatible; only the connection module changes), session Map→Redis, in-process MCP→standalone HTTP MCP services for horizontal scaling.

## Extensibility

Adding a category (ovens) = seed data + an `appliance_type` enum value. Adding a capability (returns) = one new service + MCP tool. Swapping payments = replace the payments adapter. Swapping LLM vendors = one line of Agent SDK config.
