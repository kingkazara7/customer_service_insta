import type { ServerEvent } from "@/shared/protocol";
import type { Session } from "../session";
import { searchParts } from "../services/catalog";
import { retrieveChunks } from "../rag";
import { profileSummary } from "../services/users";

export type Emit = (ev: ServerEvent) => void;

/**
 * Agent layer — handles only the three fuzzy nodes: fault diagnosis,
 * fuzzy part matching, and free-form Q&A.
 * When an LLM is available (ANTHROPIC_API_KEY or Bedrock) it runs the
 * Claude Agent SDK with read-only MCP tools; otherwise it degrades to a
 * deterministic path (RAG retrieval + templates) so the demo never breaks.
 */

function llmAvailable(): boolean {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_USE_BEDROCK === "1"
  );
}

const SCOPE_GUARD = `You are a customer service assistant for PartSelect. You ONLY handle questions about REFRIGERATOR and DISHWASHER parts: fault diagnosis, part lookup, compatibility, installation guidance, and order inquiries.
For anything outside that scope (other appliances, coding, chit-chat, news, etc.), politely reply: "Sorry, I can only help with refrigerator and dishwasher parts." and point the user back to the main menu.
Compatibility questions MUST be answered by calling the check_compatibility tool — never from memory. Before recommending parts you MUST call search_repair_guides or search_parts.
Always refer to a part by its PartSelect number (the "PS…" number, field part_no), never by the manufacturer number — the manufacturer number does not render as a clickable card and confuses the customer.
Answer in English, concisely — at most 200 words of body text.`;

async function sessionContext(s: Session): Promise<string> {
  const parts: string[] = [await profileSummary(s.userId)];
  if (s.modelNo) parts.push(`Appliance model in this session: ${s.modelNo}`);
  if (s.lastPartNos.length > 0)
    parts.push(`Parts shown most recently: ${s.lastPartNos.join(", ")}`);
  if (s.installPartNo) parts.push(`Part being installed: ${s.installPartNo}`);
  return parts.join("\n");
}

const PART_NO_RE = /PS\d{6,9}/gi;

/** Shared LLM call: streams text to the client and returns the full text (for parsing part numbers) */
async function runLlm(s: Session, prompt: string, emit: Emit): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const { catalogServer } = await import("../mcp/index");
  let full = "";
  const result = query({
    prompt,
    options: {
      systemPrompt: `${SCOPE_GUARD}\n\n## User & session context\n${await sessionContext(s)}`,
      mcpServers: { "partselect-catalog": catalogServer },
      allowedTools: [
        "mcp__partselect-catalog__search_parts",
        "mcp__partselect-catalog__get_part_details",
        "mcp__partselect-catalog__check_compatibility",
        "mcp__partselect-catalog__search_repair_guides",
        "mcp__partselect-catalog__get_install_guide",
        "mcp__partselect-catalog__find_similar_models",
        "mcp__partselect-catalog__get_parts_for_model",
        "mcp__partselect-catalog__get_order_status",
        "mcp__partselect-catalog__get_recent_orders",
      ],
      permissionMode: "bypassPermissions",
      maxTurns: 6,
      model: process.env.AGENT_MODEL ?? "claude-haiku-4-5",
    },
  });
  for await (const msg of result) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text.trim()) {
          full += block.text;
          emit({ kind: "agent_delta", text: block.text });
        }
      }
    }
  }
  return full;
}

/** Fault diagnosis: self-help checks first, then recommended part numbers (rendered as cards by the state machine) */
export async function agentDiagnose(
  s: Session,
  faultText: string,
  emit: Emit
): Promise<string[]> {
  if (llmAvailable()) {
    try {
      const full = await runLlm(
        s,
        `The user's appliance${s.modelNo ? ` (model ${s.modelNo})` : ""} has a problem: "${faultText}".
Please: 1) call search_repair_guides to consult the repair knowledge base; 2) give 2-3 troubleshooting steps the user can try themselves first; 3) call search_parts (scoped to the model) to find the parts most likely to need replacement; 4) finish with a single line "RECOMMEND:" followed by the part numbers (comma-separated, max 3), or "RECOMMEND: none" if nothing fits. Do not mention prices in the text — the system shows prices on the cards.`,
        emit
      );
      const rec = full.match(/RECOMMEND:\s*(.+)/i)?.[1] ?? "";
      const nos = [...new Set(rec.match(PART_NO_RE) ?? full.match(PART_NO_RE) ?? [])];
      if (nos.length > 0) return nos.slice(0, 3);
    } catch (err) {
      console.error("agentDiagnose LLM failed, falling back:", err);
    }
  }
  // ── Degraded path: RAG (vector first, keyword fallback) + symptom search ──
  const chunks = await retrieveChunks({
    query: faultText,
    applianceType: s.applianceType,
    limit: 1,
  });
  if (chunks.length > 0) {
    emit({
      kind: "text",
      text: `Based on our repair guides, try these troubleshooting steps first:\n\n${chunks[0].chunk_text}${
        chunks[0].source_url ? `\n\n📖 Source: ${chunks[0].source_url}` : ""
      }`,
    });
  } else {
    emit({
      kind: "text",
      text: "I couldn't find an exact repair guide for that, but here are the parts that best match the symptom:",
    });
  }
  const hits = await searchParts({
    query: faultText,
    applianceType: s.applianceType,
    modelNo: s.modelNo,
    limit: 3,
  });
  if (chunks.length > 0 && hits.length > 0) {
    emit({
      kind: "text",
      text: "If the checks above don't solve it, these are the parts most likely to need replacement:",
    });
  }
  return hits.map((p) => p.part_no);
}

/** Pre-order branch: fuzzy part-description matching (the state machine already tried an exact search) */
export async function agentMatchParts(
  s: Session,
  descText: string,
  emit: Emit
): Promise<string[]> {
  if (llmAvailable()) {
    try {
      const full = await runLlm(
        s,
        `The user wants to buy a part described as: "${descText}"${s.modelNo ? ` for appliance model ${s.modelNo}` : ""}.
Call search_parts / get_parts_for_model to find matching parts, explain the match in one sentence, then finish with a single line "RECOMMEND:" followed by part numbers (comma-separated, max 3), or "RECOMMEND: none" if nothing matches.`,
        emit
      );
      const rec = full.match(/RECOMMEND:\s*(.+)/i)?.[1] ?? "";
      const nos = [...new Set(rec.match(PART_NO_RE) ?? [])];
      return nos.slice(0, 3);
    } catch (err) {
      console.error("agentMatchParts LLM failed, falling back:", err);
    }
  }
  // Degraded path: search again with looser constraints (drop the model filter)
  const hits = await searchParts({
    query: descText,
    applianceType: s.applianceType,
    limit: 3,
  });
  if (hits.length > 0) {
    emit({
      kind: "text",
      text: s.modelNo
        ? `I didn't find an exact match for the ${s.modelNo}, but these are close — please double-check compatibility:`
        : "Here are the closest matching parts I found:",
    });
  }
  return hits.map((p) => p.part_no);
}

/** Free-form Q&A (main-menu free text, installation follow-ups) with the scope guardrail */
export async function agentAnswer(
  s: Session,
  text: string,
  emit: Emit
): Promise<void> {
  if (llmAvailable()) {
    try {
      await runLlm(s, text, emit);
      return;
    } catch (err) {
      console.error("agentAnswer LLM failed, falling back:", err);
    }
  }
  // Degraded path: answer from the knowledge base if it matches, otherwise treat as out of scope
  const chunks = await retrieveChunks({
    query: text,
    applianceType: s.applianceType,
    partNo: s.installPartNo,
    limit: 1,
  });
  if (chunks.length > 0) {
    emit({
      kind: "text",
      text: `${chunks[0].chunk_text}${
        chunks[0].source_url
          ? `\n\n📖 Source: ${chunks[0].source_url}${chunks[0].source_ref ? ` (${chunks[0].source_ref})` : ""}`
          : ""
      }`,
    });
  } else {
    emit({
      kind: "text",
      text: "Sorry, I can only help with refrigerator and dishwasher parts. Pick an option from the menu below, or try describing your part question differently.",
    });
  }
}
