import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  searchParts, getPartByNo, checkCompatibility, getCompatibleModels,
  getInstallGuide, searchDocChunks, findSimilarModels, getPartsForModel,
  type Part,
} from "../services/catalog";
import { getOrderStatus, getRecentOrders } from "../services/orders";

/**
 * Agent 侧 MCP 工具 —— 全部只读。
 * 购物车/下单/支付等改写操作不暴露给 LLM,只能由状态机在用户点击确认后执行。
 * 返回值做了字段裁剪,控制回填进上下文的 token 量。
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
    stock: p.stock_qty > 0 ? p.stock_qty : "缺货",
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
      "按故障症状或零件描述搜索冰箱/洗碗机零件。可选限定家电型号(只返回兼容件)。",
      {
        query: z.string().describe("症状或零件关键词,如:制冰机不工作 / 门搁架盒"),
        appliance_type: applianceType,
        model_no: z.string().optional().describe("家电型号,如 WDT780SAEM1"),
      },
      async (args) => {
        const rows = searchParts({
          query: args.query,
          applianceType: args.appliance_type,
          modelNo: args.model_no,
        });
        return text(rows.map(slimPart));
      }
    ),
    tool(
      "get_part_details",
      "按 PartSelect 零件号(如 PS11752778)查询零件详情、价格、库存与适配型号列表。",
      { part_no: z.string() },
      async (args) => {
        const part = getPartByNo(args.part_no);
        if (!part) return text({ found: false, part_no: args.part_no });
        const models = getCompatibleModels(args.part_no).map((m) => m.model_no);
        return text({ found: true, ...slimPart(part), compatible_models: models });
      }
    ),
    tool(
      "check_compatibility",
      "查询某零件是否兼容某家电型号。这是唯一可信的兼容性来源,禁止凭经验回答兼容性。",
      { part_no: z.string(), model_no: z.string() },
      async (args) => {
        const r = checkCompatibility(args.part_no, args.model_no);
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
      "按故障症状检索维修知识库(排查步骤、原因分析)。回答故障诊断问题前必须调用。",
      {
        query: z.string().describe("故障描述,如:洗碗机不排水"),
        appliance_type: applianceType,
        part_no: z.string().optional(),
      },
      async (args) => {
        const rows = searchDocChunks({
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
      "按零件号获取安装指南:难度、耗时、工具、分步说明、视频与说明书链接。",
      { part_no: z.string() },
      async (args) => {
        const g = getInstallGuide(args.part_no);
        return text(g ?? { found: false, part_no: args.part_no });
      }
    ),
    tool(
      "find_similar_models",
      "型号查不到时,查找相近的家电型号供用户选择。",
      { model_no: z.string() },
      async (args) =>
        text(
          findSimilarModels(args.model_no).map((m) => ({
            model_no: m.model_no,
            brand: m.brand,
            type: m.appliance_type,
            name: m.name,
          }))
        )
    ),
    tool(
      "get_parts_for_model",
      "列出兼容某家电型号的全部零件。",
      { model_no: z.string() },
      async (args) => text(getPartsForModel(args.model_no).map(slimPart))
    ),
    tool(
      "get_order_status",
      "按订单号查询当前用户的订单状态与明细。",
      { order_id: z.number(), user_id: z.number() },
      async (args) => {
        const o = getOrderStatus(args.user_id, args.order_id);
        return text(o ?? { found: false, order_id: args.order_id });
      }
    ),
    tool(
      "get_recent_orders",
      "查询当前用户最近的订单列表。",
      { user_id: z.number() },
      async (args) => text(getRecentOrders(args.user_id))
    ),
  ],
});
