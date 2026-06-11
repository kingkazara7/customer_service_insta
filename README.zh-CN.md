# PartSelect 配件助手 — Instalily 案例研究(中文设计文档)

> 本文档是 [README.md](README.md)(英文交付版)的中文对照版,供讲解与答辩使用。

一个已部署上线的电商聊天客服,严格限定**冰箱**与**洗碗机**配件领域。完整购买旅程全部在一个聊天框内完成:身份识别 → 故障诊断 → 零件查找 → 兼容性确认 → 安装指导 → 购物车 → 结算 → 支付。

**线上演示:** https://customerservice.lambdapen.com
**演示账号:** `demo@example.com`(有家电与订单历史)· `mike@example.com`(只买过零件——观察机型反推)· 或直接游客访问。

---

## 一、我们做了什么

| 模块 | 交付内容 |
|---|---|
| **聊天 UI** | Next.js 16 + React 19,PartSelect 品牌配色(青绿/金黄),SSE 流式输出;富消息类型:家电卡片、零件卡片(价格/库存/兼容标签)、安装指南卡片、购物车抽屉、地址与支付表单、订单确认卡片 |
| **身份系统** | 开场可选"邮箱 / 游客":邮箱载入购买历史;游客懒建档、绝不拦截任何操作;会话中输入裸邮箱可随时切换账号 |
| **个性化** | 已购家电渲染成一键卡片;只买过零件的用户由**零件兼容性反推可能机型**("Likely yours");地址自动预填上次订单 |
| **故障诊断** | 先给带来源链接的自助排查步骤(RAG),再给可确认的替换零件卡片 |
| **电商闭环** | 库存感知卡片("仅剩 N 件"/"缺货")、确认制加购、订单摘要、演示版 Visa 支付(Luhn 校验,**无真实扣款**)、事务化扣库存(防超卖) |
| **自助保养** | 清洁/保养知识库(洗碗机滤网清洗、清洁片循环、除垢、冷凝器清洁),清洁用品本身作为可购买商品 |
| **Agent** | Claude(Sonnet 4.5)on Amazon Bedrock,经 Claude Agent SDK 驱动,配 9 个只读 MCP 工具,且具备完整可用的无 LLM 降级模式 |
| **检索** | 双层:结构化事实走精确 SQL,模糊知识走向量 RAG(Titan Embeddings v2,pgvector-ready),关键词检索自动兜底 |
| **基础设施** | EC2(nginx + systemd + Let's Encrypt TLS + 自有域名),RDS PostgreSQL 已就绪待迁移,Bedrock 提供 LLM 与向量 |
| **测试** | 41 项端到端断言:全部流程分支、案例三道例题、库存边界、防护栏、身份路径 |

---

## 二、系统架构

```
浏览器(Next.js 聊天 UI)
   │  SSE(每轮:一个客户端事件进 → 一串服务端事件出)
   ▼
/api/chat
   ├── 状态机层(确定性,零 LLM token)────────┐
   │   身份门 · 固定菜单 · M/P 模块 ·           │  两层调用的是
   │   零件号/型号精确查询 · 结算 · 支付         │  同一套业务服务
   │                                            │
   └── Agent 层(Claude Agent SDK harness)─────┘
       仅 3 个模糊节点:故障诊断 · 零件模糊匹配 · 自由问答
       9 个只读 MCP 工具(写操作永不暴露)
              │
              ▼
   services/(catalog · orders · users · payments)← 单一事实来源
              │
              ▼
   SQLite(开发)/ RDS PostgreSQL + pgvector(生产路径)
   Amazon Bedrock:Claude Sonnet 4.5(推理)· Titan Embeddings v2(向量)
```

---

## 三、Agent 设计

### 3.1 状态机 + LLM 混合,而非纯 Agent

这是整个项目的定调决策。对话被建模为显式状态机([stateMachine.ts](partselect-agent/src/server/stateMachine.ts)),LLM 只在**恰好三个**真正需要自然语言理解的节点被调用:

1. **故障诊断** — 自由文本症状 → 排查步骤 → 零件推荐
2. **零件模糊匹配** — "门上放调料的那个盒子" → 候选零件(且仅在确定性搜索无果之后)
3. **自由问答** — 安装追问、意图捷径分类不了的一切

其余环节——三按钮菜单、"知道零件号吗"、型号收集、相近选项 chips、购物车、地址、支付——全部是确定性代码,输出带类型的 UI 事件。带来三个结果:

- **Token 经济性:** 一次完整购买流程约 2–4k token,纯 Agent 方案约 20k;案例中两道零 token 例题(安装查询、兼容性确认)从头到尾不碰 LLM
- **延迟:** 固定步骤毫秒级响应
- **可预测性:** 结算流程不可能被模型漂移带偏

任何自由文本先过确定性意图捷径再考虑 LLM:正则提取零件号(`PS\d+`)与型号,关键词路由安装/兼容/报修/购买意图。"Is **this part** compatible with my WDT780SAEM1?" 里的代词由会话状态(`lastPartNos`)消解,不靠模型。

### 3.2 Harness:Claude Agent SDK on Bedrock

Agent 跑在 **Claude Agent SDK**(`query()`)上,它提供 Agent 循环、MCP 工具分发、提示词缓存与流式输出。EC2 上通过 **Amazon Bedrock** 认证(`CLAUDE_CODE_USE_BEDROCK=1`),模型访问完全走 AWS IAM——服务链路中没有第三方 API key。模型只是一个环境变量(`AGENT_MODEL`),换供应商/换模型等于改一行配置。

会话上下文以**一行画像摘要**注入("User appliances: … Previously purchased parts: …"),而不是回放聊天历史——个性化的 token 成本接近零。

### 3.3 降级模式:演示永不挂

每个 LLM 节点都有确定性兜底(关键词 RAG + 模板话术 + 症状搜索)。Bedrock 不可达、key 缺失、模型中途报错——同样的流程照常完成:卡片、结算、一切。这也是为什么在 Bedrock 模型权限审批通过之前,系统就已经可以完整演示。

### 3.4 防护栏(三层相互独立)

1. **提示词锁定范围:** 系统提示词将助手限定在冰箱/洗碗机配件,且强制兼容性与诊断结论必须来自工具调用
2. **工具只读:** LLM 物理上无法改写状态——加购、下单、扣款只存在于用户点击确认的 UI 事件背后
3. **事实确定性:** 兼容性答案永远来自 SQL 兼容性矩阵;模型只转述工具结果,绝不编造。超范围请求(线上实测:"给我写首诗")在 LLM 模式和降级模式下都会得到礼貌拒绝

---

## 四、MCP 设计

### 4.1 形态

业务能力放在四个纯 TypeScript 服务模块里——[catalog](partselect-agent/src/server/services/catalog.ts)、[orders](partselect-agent/src/server/services/orders.ts)、[users](partselect-agent/src/server/services/users.ts)、[payments](partselect-agent/src/server/services/payments.ts)。一个薄薄的包装层([mcp/index.ts](partselect-agent/src/server/mcp/index.ts))用 SDK 的 `createSdkMcpServer` + `tool()`(zod 模式)把其中**只读子集**注册为进程内 MCP server:

| 工具 | 用途 |
|---|---|
| `search_parts` | 症状/描述 → 零件,可限定型号(只返回兼容件) |
| `get_part_details` | 零件号 → 详情、价格、库存、适配型号 |
| `check_compatibility` | **唯一**可信的兼容性来源 |
| `search_repair_guides` | 故障排查知识库 RAG |
| `get_install_guide` | 结构化指南:难度/耗时/工具/步骤/视频/说明书 |
| `find_similar_models` | 型号查不到时给相近选项 |
| `get_parts_for_model` | 某型号全部兼容零件 |
| `get_order_status` / `get_recent_orders` | 当前用户的订单查询 |

### 4.2 设计原则

- **单一事实来源。** 状态机直接调用服务函数(零 token);Agent 经 MCP 触达*同一批函数*。一份实现、两个消费者——修一个查询,两条路径同时受益
- **写操作不是工具。** `addToCart`、`createOrder`、`charge` 被刻意排除在 MCP 面之外。这是机制级安全保证,不是提示词层面的承诺
- **Token 形状的返回值。** 工具输出是裁剪过的投影(`slimPart`)——不返回原始行、不带无用列,把工具结果占用的上下文压到最小
- **现在进程内,将来可远程。** SDK MCP server 目前跑在 Node 进程内(无子进程/网络开销)。但 MCP 本质是线协议,同一套工具定义可以原样提升为独立 HTTP MCP 服务、独立部署与扩缩容——或者被完全不同的客户端复用(内部客服工作台、支持团队的 Claude Desktop),工具代码一行不改

---

## 五、数据库设计与 schema 合理性

Schema 见 [schema.sql](partselect-agent/src/server/db/schema.sql)。开发用 SQLite,全程保持 ANSI 兼容 SQL,因此规划中的 RDS PostgreSQL 迁移只需替换连接模块(RDS 实例已就绪,pgvector-ready)。

### 5.1 每张表为什么这样设计

**`parts`** — 目录核心。关键列:
- `stock_qty` 驱动整个库存体验:"现货"/"仅剩 N 件"(≤5)/"缺货"三态、加购拦截、下单时事务扣减。库存放在数据库而不是提示词文本里,LLM 永远不可能"卖出"一个没货的零件
- `symptoms`(逗号分隔短语)让零件**可以按问题被发现**("ice maker not working"),而不只是按名称——它支撑零 LLM 的确定性症状搜索,同时充当排序信号(症状命中权重高于名称命中)
- `part_no`(PartSelect 号)是聊天里约定俗成的"外键";`mfr_part_no` 对应真实顾客拿厂家号交叉查询的习惯

**`appliance_models` + `compatibility`** — 经典多对多联结表。兼容性是**关系数据,不是文本**,因为"适不适配"必须精确回答——错答一个"是"就是一单退货。这张联结表还让反向查询同样便宜:*型号查零件*(预购浏览)和*零件查型号*——后者正是只买过零件用户的**机型反推**实现(`已购零件 → 兼容性 → 候选机型,按匹配数排序`)。

**`install_guides`** — 刻意做成*独立结构化表*而非文本块。难度、分钟数、工具、有序步骤是形态稳定的事实;结构化存储意味着安装分支是**零 token 的 SQL 直查**,前端直接渲染成卡片。视频/说明书 URL 是普通列——链接是 payload 不是语义,永远不参与 embedding。

**`doc_chunks`** — 非结构化的第二层(维修指南、说明书节选、视频字幕)。每块带 `symptom_tags`(检索信号)、`source_url` + `source_ref`(页码/时间戳——回答可以标注来源)、`embedding` BLOB(Float32;pgvector 下变成 `vector(1024)`,进程内余弦换成 `<=>` 操作符)。**结构化事实进 SQL、模糊知识进向量**的双层划分,正是 Agent 设计在 schema 层的镜像:精确问题精确答,模糊问题走检索。

**`users` / `user_appliances`** — 身份与个性化闭环。`user_appliances.source` 这个小枚举承担了实际工作:`purchased`(已购——任何更新都不会降级)、`searched`(会话中确认过)。机型反推在查询时实时计算而非落库——这样建议永远反映最新的兼容性数据。游客就是 `email = NULL` 的普通行——这也是游客模式不需要改任何 schema 的原因。

**`carts` / `orders` / `order_items`** — 标准电商范式,加两个刻意的决定:`order_items.unit_price` **在下单时刻快照价格**(目录价会变,订单历史不能变);订单创建在**单个事务**里完成"复核库存 → 扣减 → 写订单 → 清购物车 → 会话机型升级为已购"——超卖竞态在数据库层关死,不靠应用层的侥幸。

**`search_history`** — 只追加的行为日志,供画像摘要与未来分析使用(例如"搜过某型号两次但没买"→ 低置信度持有推断)。

### 5.2 为什么 SQLite → PostgreSQL,而不用独立向量库

目录规模(10²–10⁴ 零件)下,独立向量数据库只增加运维依赖、不带来可感知收益。pgvector 让向量**与过滤条件同库**——一条 SQL 同时完成 `appliance_type = 'dishwasher' AND part_id = …` 过滤与相似度排序。`EmbeddingProvider` 接口(生产 Bedrock Titan v2、离线可选本地模型、`none` → 关键词兜底)保证检索层可整体替换而调用方无感。

---

## 六、扩展性与可伸缩性

| 变更 | 改动半径 |
|---|---|
| 新增品类(烤箱) | 种子数据 + `appliance_type` 枚举值——流程、工具、UI 全部品类无关 |
| 新增能力(退换货、保修) | 一个新服务模块 + 一次 MCP 工具注册 |
| 真实支付 | 替换 payments 适配器(接口已按网关形状设计) |
| 换 LLM 供应商/模型 | 一个环境变量(Agent SDK 抽象了提供商) |
| 真实身份认证 | 在 `identifyUser` 后插入验证步骤(魔法链接/验证码)——缝已留好 |
| 水平扩展 | 会话 Map → Redis(一个文件);进程内 MCP → 独立 HTTP MCP 服务;SQLite → RDS(换连接模块);无状态 Next.js 挂负载均衡 |
| 真实 PartSelect 数据 | 种子脚本*就是*数据摄入契约——爬虫对准同样的数组结构灌数据即可 |

协议先行的设计处处受益:前后端共享的带类型 `ClientEvent`/`ServerEvent` 契约([protocol.ts](partselect-agent/src/shared/protocol.ts)),新增卡片类型或操作 = 一个类型 + 一个渲染器 + 一个状态机分支。

---

## 七、对话流程(已实现)

- **开场:** 邮箱/游客二选一(游客在首次操作时懒建档——绝不拦截)→ 个性化家电卡片(已购,或由已购零件反推)→ 三按钮菜单 + 自由输入兜底
- **报修:** 收集型号(M 模块:查不到 → 相近选项 → 致歉)→ 症状描述 → 带来源的排查步骤 → 零件卡片
- **预购:** 知道零件号 → 精确查询;不知道 → 型号 + 描述 → 先确定性搜索,无果才进 LLM
- **安装:** 零件号或从已购零件点选 → 结构化指南卡片(零 token)→ 模糊追问进 Agent → "顺便订购这个零件吗?"
- **P 模块(全局):** 价格先展示、用户确认才入购物车;低库存与缺货状态;相近零件 chips;致歉兜底
- **结算:** 摘要确认 → 地址(预填)→ 演示 Visa(4 开头 + 16 位 + Luhn)→ 事务化下单 → 购买历史反哺下次会话的卡片

## 八、案例例题覆盖(全部验证,见 [test-flow.ts](partselect-agent/scripts/test-flow.ts))

| 查询 | 路径 | 用 LLM? |
|---|---|---|
| "How can I install part number PS11752778?" | 意图捷径 → SQL 安装卡片 | 否——0 token |
| "Is this part compatible with my WDT780SAEM1?" | 代词消解 → 兼容性矩阵 → 不兼容(冰箱件) | 否——0 token |
| "The ice maker on my Whirlpool fridge is not working…" | 报修意图 → 收型号 → RAG + 诊断 → 零件卡片 | 诊断节点 |
| "My dishwasher is clogged, how do I clean it?" | 诊断 → 自助保养指南(滤网清洗、清洁片循环)+ 清洁用品购买卡片 | 诊断节点 |
| "Write me a poem" | 防护栏 → 礼貌拒绝 | — |

## 九、本地运行

```bash
cd partselect-agent
npm install
npm run db:seed     # SQLite + 种子:18 型号 / 52 零件 / 10 指南 / 16 知识块
npm run dev         # http://localhost:3000(不配任何 key 也完整可用)
npm run test:flow   # 41 项端到端断言
```

可选:设 `ANTHROPIC_API_KEY` 或 `CLAUDE_CODE_USE_BEDROCK=1` 启用真实 LLM;`EMBEDDINGS_PROVIDER=bedrock npm run embed` 启用向量检索。

## 十、部署(us-east-2)与后续

EC2 t3.small(nginx → systemd 托管的 Next.js,Let's Encrypt TLS,弹性 IP)· Bedrock 经 IAM 限权凭证 · RDS PostgreSQL 已就绪。资源清单:`DEPLOY-INFO.md`。

已知后续:SQLite→RDS 迁移(服务层异步 pg 重构)、可验证的身份认证、真实目录数据摄入。
