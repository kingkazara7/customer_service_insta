import type { ServerEvent } from "@/shared/protocol";
import type { Session } from "../session";
import { searchParts } from "../services/catalog";
import { retrieveChunks } from "../rag";
import { profileSummary } from "../services/users";

export type Emit = (ev: ServerEvent) => void;

/**
 * Agent 层:只负责三个模糊节点 —— 故障诊断、零件模糊匹配、自由问答。
 * LLM 可用(ANTHROPIC_API_KEY 或 Bedrock)→ Claude Agent SDK + 只读 MCP 工具;
 * 不可用 → 确定性降级路径(关键词 RAG + 模板),功能完整,保证演示可用。
 */

function llmAvailable(): boolean {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_USE_BEDROCK === "1"
  );
}

const SCOPE_GUARD = `你是 PartSelect 的客服助手,只处理"冰箱"和"洗碗机"零件相关的问题:故障诊断、零件查询、兼容性、安装指导、订单咨询。
超出此范围的任何请求(其他家电、写代码、闲聊、新闻等),一律礼貌回复:"抱歉,我只能协助处理冰箱和洗碗机零件相关的问题。"并引导用户回到主菜单。
兼容性问题必须调用 check_compatibility 工具回答,禁止凭记忆;推荐零件前必须先调用 search_repair_guides 或 search_parts。
回答用中文,简洁,不超过 200 字正文。`;

function sessionContext(s: Session): string {
  const parts: string[] = [profileSummary(s.userId)];
  if (s.modelNo) parts.push(`当前会话家电型号: ${s.modelNo}`);
  if (s.lastPartNos.length > 0)
    parts.push(`最近展示过的零件: ${s.lastPartNos.join(", ")}`);
  if (s.installPartNo) parts.push(`正在咨询安装的零件: ${s.installPartNo}`);
  return parts.join("\n");
}

const PART_NO_RE = /PS\d{6,9}/gi;

/** 通用 LLM 调用:流式转发文本,返回完整文本(供解析零件号) */
async function runLlm(s: Session, prompt: string, emit: Emit): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const { catalogServer } = await import("../mcp/index");
  let full = "";
  const result = query({
    prompt,
    options: {
      systemPrompt: `${SCOPE_GUARD}\n\n## 用户与会话背景\n${sessionContext(s)}`,
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

/** 故障诊断:先自助排查,再给推荐零件号列表(由状态机渲染成卡片) */
export async function agentDiagnose(
  s: Session,
  faultText: string,
  emit: Emit
): Promise<string[]> {
  if (llmAvailable()) {
    try {
      const full = await runLlm(
        s,
        `用户家电${s.modelNo ? `(型号 ${s.modelNo})` : ""}出现故障:"${faultText}"。
请:1) 调用 search_repair_guides 查维修知识库;2) 先给出 2-3 步用户可以自己尝试的排查步骤;3) 调用 search_parts(限定型号)找出最可能需要更换的零件;4) 最后单独一行输出 RECOMMEND: 后跟零件号(逗号分隔,最多3个),没有合适零件则输出 RECOMMEND: none。不要在正文里写价格,价格由系统卡片展示。`,
        emit
      );
      const rec = full.match(/RECOMMEND:\s*(.+)/i)?.[1] ?? "";
      const nos = [...new Set(rec.match(PART_NO_RE) ?? full.match(PART_NO_RE) ?? [])];
      if (nos.length > 0) return nos.slice(0, 3);
    } catch (err) {
      console.error("agentDiagnose LLM failed, falling back:", err);
    }
  }
  // ── 降级路径:RAG(向量优先,自动退回关键词)+ 症状搜索 ──
  const chunks = await retrieveChunks({
    query: faultText,
    applianceType: s.applianceType,
    limit: 1,
  });
  if (chunks.length > 0) {
    emit({
      kind: "text",
      text: `根据维修知识库,建议您先尝试以下排查:\n\n${chunks[0].chunk_text}${
        chunks[0].source_url ? `\n\n📖 来源: ${chunks[0].source_url}` : ""
      }`,
    });
  } else {
    emit({
      kind: "text",
      text: "我没有找到完全匹配的维修指南,以下是根据症状推荐的零件:",
    });
  }
  const hits = searchParts({
    query: faultText,
    applianceType: s.applianceType,
    modelNo: s.modelNo,
    limit: 3,
  });
  if (chunks.length > 0 && hits.length > 0) {
    emit({ kind: "text", text: "如果排查后仍未解决,以下零件最可能需要更换:" });
  }
  return hits.map((p) => p.part_no);
}

/** 预购分支:模糊零件描述匹配(状态机先做过精确搜索,无果才会调到这里) */
export async function agentMatchParts(
  s: Session,
  descText: string,
  emit: Emit
): Promise<string[]> {
  if (llmAvailable()) {
    try {
      const full = await runLlm(
        s,
        `用户想购买零件,描述是:"${descText}"${s.modelNo ? `,家电型号 ${s.modelNo}` : ""}。
请调用 search_parts / get_parts_for_model 找出匹配的零件,用一句话说明匹配理由,最后单独一行输出 RECOMMEND: 后跟零件号(逗号分隔,最多3个),找不到输出 RECOMMEND: none。`,
        emit
      );
      const rec = full.match(/RECOMMEND:\s*(.+)/i)?.[1] ?? "";
      const nos = [...new Set(rec.match(PART_NO_RE) ?? [])];
      return nos.slice(0, 3);
    } catch (err) {
      console.error("agentMatchParts LLM failed, falling back:", err);
    }
  }
  // 降级:放宽限定条件再搜一次(去掉型号限定)
  const hits = searchParts({
    query: descText,
    applianceType: s.applianceType,
    limit: 3,
  });
  if (hits.length > 0) {
    emit({
      kind: "text",
      text: s.modelNo
        ? `没有找到与 ${s.modelNo} 完全匹配的零件,以下是相近的零件(请注意核对兼容性):`
        : "为您找到以下相近零件:",
    });
  }
  return hits.map((p) => p.part_no);
}

/** 自由问答(主菜单自由输入、安装追问):范围防护栏生效 */
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
  // 降级:RAG 命中则给知识库内容,否则按范围外处理
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
          ? `\n\n📖 来源: ${chunks[0].source_url}${chunks[0].source_ref ? `(${chunks[0].source_ref})` : ""}`
          : ""
      }`,
    });
  } else {
    emit({
      kind: "text",
      text: "抱歉,我只能协助处理冰箱和洗碗机零件相关的问题。您可以从下方菜单选择服务,或换个方式描述您的零件问题。",
    });
  }
}
