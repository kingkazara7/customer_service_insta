import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  searchParts, getPartByNo, checkCompatibility, getCompatibleModels,
  getInstallGuide, searchDocChunks, findSimilarModels, getPartsForModel,
  type Part,
} from "../services/catalog";
import { getOrderStatus, getRecentOrders } from "../services/orders";

/**
 * Agent-facing MCP tools — all read-only.
 * Write operations (cart, orders, payment) are never exposed to the LLM;
 * they can only be triggered by explicit user confirmation in the state machine.
 * Tool results are trimmed to a compact shape to limit context tokens.
 */

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj) }] };
}

function slimPart(p: Part) {
  return {
    part_no: p.part_no,
    mfr_part_no: p.mfr_part_no,
    name: p.name,
    brand: p.brand,
    appliance_type: p.appliance_type,
    price: p.price,
    stock: p.stock_qty > 0 ? p.stock_qty : "out_of_stock",
    fixes: p.symptoms,
  };
}

const applianceType = z.enum(["refrigerator", "dishwasher"]).optional();

export const catalogServer = createSdkMcpServer({
  name: "partselect-catalog",
  version: "1.0.0",
  tools: [
    tool(
      "search_parts",
      "Search refrigerator/dishwasher parts by symptom or part description. Optionally scope to an appliance model (returns compatible parts only).",
      {
        query: z.string().describe("Symptom or part keywords, e.g. 'ice maker not working' / 'door shelf bin'"),
        appliance_type: applianceType,
        model_no: z.string().optional().describe("Appliance model number, e.g. WDT780SAEM1"),
      },
      async (args) => {
        const rows = await searchParts({
          query: args.query,
          applianceType: args.appliance_type,
          modelNo: args.model_no,
        });
        return text(rows.map(slimPart));
      }
    ),
    tool(
      "get_part_details",
      "Look up a part by PartSelect number (e.g. PS11752778): details, price, stock, and the list of compatible models.",
      { part_no: z.string() },
      async (args) => {
        const part = await getPartByNo(args.part_no);
        if (!part) return text({ found: false, part_no: args.part_no });
        const models = (await getCompatibleModels(args.part_no)).map((m) => m.model_no);
        return text({ found: true, ...slimPart(part), compatible_models: models });
      }
    ),
    tool(
      "check_compatibility",
      "Check whether a part fits an appliance model. This is the ONLY trusted source for compatibility — never answer compatibility from memory.",
      { part_no: z.string(), model_no: z.string() },
      async (args) => {
        const r = await checkCompatibility(args.part_no, args.model_no);
        return text({
          compatible: r.compatible,
          part_found: r.partFound,
          model_found: r.modelFound,
          part_name: r.part?.name ?? null,
          model_name: r.model ? `${r.model.brand} ${r.model.model_no}` : null,
          similar_models: r.similarModels.map((m) => m.model_no),
          similar_parts: r.similarParts.map((p) => p.part_no),
        });
      }
    ),
    tool(
      "search_repair_guides",
      "Search the repair knowledge base (troubleshooting steps, causes) by symptom. MUST be called before answering any diagnosis question.",
      {
        query: z.string().describe("Fault description, e.g. 'dishwasher not draining'"),
        appliance_type: applianceType,
        part_no: z.string().optional(),
      },
      async (args) => {
        const rows = await searchDocChunks({
          query: args.query,
          applianceType: args.appliance_type,
          partNo: args.part_no,
        });
        return text(
          rows.map((c) => ({
            text: c.chunk_text,
            source: c.source_url,
            ref: c.source_ref,
          }))
        );
      }
    ),
    tool(
      "get_install_guide",
      "Get the installation guide for a part: difficulty, time, tools, step-by-step instructions, video and manual links.",
      { part_no: z.string() },
      async (args) => {
        const g = await getInstallGuide(args.part_no);
        return text(g ?? { found: false, part_no: args.part_no });
      }
    ),
    tool(
      "find_similar_models",
      "When a model number can't be found, list close model numbers for the user to pick from.",
      { model_no: z.string() },
      async (args) =>
        text(
          (await findSimilarModels(args.model_no)).map((m) => ({
            model_no: m.model_no,
            brand: m.brand,
            type: m.appliance_type,
            name: m.name,
          }))
        )
    ),
    tool(
      "get_parts_for_model",
      "List all parts compatible with an appliance model.",
      { model_no: z.string() },
      async (args) => text((await getPartsForModel(args.model_no)).map(slimPart))
    ),
    tool(
      "get_order_status",
      "Look up the status and line items of one of the current user's orders.",
      { order_id: z.number(), user_id: z.number() },
      async (args) => {
        const o = await getOrderStatus(args.user_id, args.order_id);
        return text(o ?? { found: false, order_id: args.order_id });
      }
    ),
    tool(
      "get_recent_orders",
      "List the current user's recent orders.",
      { user_id: z.number() },
      async (args) => text(await getRecentOrders(args.user_id))
    ),
  ],
});
