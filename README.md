# PartSelect 配件助手 — Instalily 案例研究

针对 PartSelect 电商场景(限定**冰箱**与**洗碗机**配件)的智能聊天客服:故障诊断、零件查询、兼容性确认、安装指导、下单支付,全流程在聊天框内完成。

## 架构总览

```
浏览器(Next.js 聊天 UI,PartSelect 品牌风格)
   │  SSE(每轮:事件入 → 事件流出)
   ▼
/api/chat
   ├── 状态机层(确定性流程,零 LLM token)──┐
   │    按钮分支 / 表单 / 零件号·型号精确查询  │ 共用同一套
   │                                          │ 业务服务(MCP 工具)
   └── Agent 层(Claude Agent SDK harness)───┘
        仅 3 个模糊节点:故障诊断 / 零件模糊匹配 / 自由问答
        只读 MCP 工具 ×9(改写操作不暴露给 LLM)
              │
              ▼
   SQLite(开发)/ RDS PostgreSQL + pgvector(生产)
   Amazon Bedrock:Claude(对话)+ Titan Embeddings v2(向量)
```

### 核心设计决策

1. **状态机 + LLM 混合,而非纯 Agent。** 固定提问(损坏/预购/安装)、知不知道零件号、地址、支付等节点全部由状态机+前端组件处理,**0 token**;只有真正需要理解自然语言的三个节点才调 LLM。一次完整购买流程 token 消耗从纯 Agent 方案的 ~20k 降到 ~2-4k(LLM 不可用时甚至全程 0 token,系统自动降级为关键词检索 + 模板话术,演示永不挂)。
2. **业务逻辑只写一份。** 四组服务(catalog/orders/users/payments)同时被状态机直接调用和包装成 MCP 工具给 Agent,单一事实来源。
3. **LLM 只读。** 加购物车、下单、扣款只能由用户点击确认按钮触发,从机制上杜绝模型误下单;兼容性答案一律来自兼容性矩阵 SQL,禁止模型凭记忆回答。
4. **个性化省 token。** 用户的家电与购买历史存档,开场渲染成可点击卡片(点击=注入型号,省 2-4 轮澄清);Agent 上下文注入一行画像摘要而非回放历史会话。

## 对话流程(v2,已实现)

- 开场:历史家电卡片 + 三按钮菜单(🔧 家电损坏了 / 🛒 预购替换零件 / 📦 如何安装我的部件)+ 自由输入兜底
- **损坏分支**:收集型号(M 模块)→ 故障描述 → 先给自助排查步骤(RAG 带来源)→ 推荐零件卡片
- **预购分支**:知道零件号?→ 是:精确查询;否:收集型号 + 描述 → 先确定性搜索,无果才进 LLM
- **安装分支**:零件号(可从已购零件点选)→ 结构化安装卡片(难度/耗时/工具/步骤/视频/说明书,SQL 直查零 token)→ 模糊追问才进 LLM → 询问是否顺带订购
- **M 模块**:型号查不到 → "无法查询到对应型号" + 相近型号选项 → 都不选 → "抱歉,我们查询不到您所寻找的配件" → 回主菜单
- **P 模块**:卡片先展示价格(含"仅剩 N 件"低库存提示),用户点击确认才加购;零库存 → "该零件已经没有库存" + 替代推荐;查不到 → 相近配件选项 → 致歉
- **结算**:订单摘要确认 → 地址表单(自动预填历史地址)→ 演示支付(Visa 4 开头 16 位 + Luhn 即通过,**无真实扣款**)→ 同一事务写订单+扣库存(防超卖)→ 购买记录反哺家电卡片(闭环)

## 目录结构

```
partselect-agent/
├── src/app/                # Next.js 页面 + /api/chat SSE 路由
├── src/components/         # 聊天 UI:家电/零件/安装卡片、表单、购物车抽屉
├── src/shared/protocol.ts  # 前后端共享事件协议
├── src/server/
│   ├── stateMachine.ts     # 确定性流程核心(M/P 模块、意图捷径、结算)
│   ├── session.ts          # 会话状态(内存 Map,生产可换 Redis)
│   ├── agent/              # Claude Agent SDK 集成 + 降级路径 + 范围防护栏
│   ├── mcp/                # 9 个只读 MCP 工具(createSdkMcpServer)
│   ├── services/           # catalog / orders / users / payments(单一事实来源)
│   ├── rag.ts              # 向量检索优先、关键词自动兜底
│   ├── embeddings/         # Bedrock Titan v2 / 本地模型 provider 抽象
│   └── db/                 # schema.sql + 种子数据(28 零件/12 型号/8 指南/10 文档块)
└── scripts/                # seed / embed / test-flow(28 项端到端断言)
```

## 本地运行

```bash
cd partselect-agent
npm install
npm run db:seed        # 初始化 SQLite + 种子数据
npm run dev            # http://localhost:3000
npm run test:flow      # 28 项端到端断言(含案例三道例题)
```

不配任何 API key 即可完整演示(降级模式)。启用真实 LLM:设 `ANTHROPIC_API_KEY`,或在 EC2 上设 `CLAUDE_CODE_USE_BEDROCK=1`(IAM 角色授权)。启用向量检索:`EMBEDDINGS_PROVIDER=bedrock npm run embed`。

## 案例例题验证(scripts/test-flow.ts)

| 例题 | 路径 | LLM? |
|---|---|---|
| How can I install part number PS11752778? | 意图捷径 → SQL 直查安装指南卡片 | 否(0 token) |
| Is this part compatible with my WDT780SAEM1? | 代词消解 → 兼容性矩阵查询 → ❌ 不兼容(它是冰箱件) | 否(0 token) |
| Ice maker not working, how can I fix it? | 报修语义 → 收型号 → RAG 排查步骤 + 零件卡片 | 诊断节点 |
| 超范围问题(写诗等) | 双层防护栏 → 礼貌拒绝 | — |

## AWS 部署(us-east-2)

资源清单见 `DEPLOY-INFO.md`:EC2 t3.small(instalily_project)+ RDS PostgreSQL(instalily-db, pgvector)+ Bedrock(Claude / Titan)。生产演进:SQLite→RDS(服务层 SQL 保持 ANSI 兼容,只换连接模块)、会话 Map→Redis、进程内 MCP→独立 HTTP MCP 服务横向扩展。

## 扩展性

加新品类(烤箱)= 种子数据 + `appliance_type` 枚举;加新能力(退换货)= 新增一个 service + MCP 工具;换支付 = 替换 payments 适配器;换 LLM 供应商 = Agent SDK 配置一行。
