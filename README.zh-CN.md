# PartSelect 配件助手

一个已部署上线的电商聊天客服,严格限定**冰箱**与**洗碗机**配件领域。完整购买旅程全部在一个聊天框内完成:身份识别 →(可选拍照)→ 故障诊断或零件查找 → 兼容性确认 → 安装指导 → 购物车 → 结算 → 支付。

**线上演示:** https://customerservice.lambdapen.com
**试试看:** `demo@example.com`(有已购家电+订单历史)· `mike@example.com`(只买过零件——观察机型反推)· 或 **以游客访问** · 或点 **📷** 上传一张铭牌照片。

---

## 目录

1. [我们包含了什么](#一我们包含了什么)
2. [架构](#二架构)
3. [状态机](#三状态机)
4. [每个功能是如何实现的](#四每个功能是如何实现的)
5. [数据库 schema](#五数据库-schema)
6. [目录结构](#六目录结构)
7. [运行](#七运行)
8. [部署](#八部署)

---

## 一、我们包含了什么

| 能力 | 概述 |
|---|---|
| **品牌化聊天 UI** | Next.js 16 + React 19,PartSelect 青绿/金黄配色,SSE 流式,丰富的交互消息类型(卡片、chips、表单) |
| **身份(邮箱或游客)** | 邮箱载入购买历史;游客全功能且懒建档;会话中输入裸邮箱可切换账号 |
| **个性化** | 已购家电渲染成一键卡片;只买过零件的用户由**零件兼容性反推可能机型**;地址自动预填上次订单 |
| **视觉输入 📷** | 上传**铭牌照片**(读出型号)或**坏零件照片**(识别零件)→ 进入流程;非家电照片被拒绝 |
| **故障诊断** | 先给带来源链接的自助排查步骤(RAG),再给可确认的替换零件卡片 |
| **零件查询与搜索** | 按精确 PS 号、按故障症状、或按自然语言描述;已知型号时限定兼容件 |
| **兼容性确认** | 来自关系型「零件↔型号」矩阵的精确答案——绝不猜测 |
| **安装指导** | 结构化指南卡片(难度/耗时/工具/步骤/视频/说明书),零 token SQL 直查;模糊追问才进 LLM |
| **电商** | 库存感知卡片("仅剩 N 件"/"缺货")、确认制加购、订单摘要、地址表单、**演示版 Visa 支付**(Luhn 校验、无真实扣款)、事务化下单 + 防超卖扣库存 |
| **自助保养** | 清洁/除垢/冷凝器清洁知识,清洁用品本身作为可购买商品 |
| **实时兜底** | 目录未命中时,实时抓取 partselect.com 页面、解析、**写入目录**(自增长);proxy-ready,默认关闭 |
| **Agent** | Claude(Sonnet 4.5)on Amazon Bedrock,经 Claude Agent SDK;仅在 3 个模糊节点调用;**无 LLM 也完整可用的降级模式** |
| **MCP 工具** | 9 个只读工具(开放标准,可复用、可远程化) |
| **双层检索** | 结构化事实走精确 SQL + 向量 RAG(Titan Embeddings v2),关键词自动兜底 |
| **数据库** | 异步驱动双后端(`DB_DRIVER`):开发用 SQLite,**生产用 RDS PostgreSQL** |
| **真实目录数据** | 从 partselect.com 摄入约 620 个真实零件(真实 PS 号、价格、库存、症状、视频) |
| **范围防护栏** | 三层防护把 Agent 锁定在冰箱/洗碗机配件 |
| **测试** | 43 项自动化端到端断言 |
| **部署** | EC2 + nginx + systemd + Let's Encrypt TLS + 自有域名;Bedrock 走 IAM |

---

## 二、架构

```
浏览器 — Next.js 聊天 UI(卡片、chips、表单、📷 上传)
   │  SSE:一个 ClientEvent 进 → 一串 ServerEvent 出
   ▼
/api/chat(Next.js 路由,Node 运行时)
   │
   ▼
状态机(stateMachine.ts —— 确定性,零 LLM token)
   身份门 · 菜单 · M 模块(型号)· P 模块(零件)·
   安装 · 购物车 · 结算 · 支付 · 意图捷径
   │                                   │
   │ 直接调用                          │ 把同一批函数包装成
   ▼                                   ▼ 只读 MCP 工具
服务层(catalog · orders · users · payments)  ◄── 单一事实来源
   │
   ├── Agent 层(agent/index.ts)—— 仅 3 个模糊节点:
   │     诊断 · 零件模糊匹配 · 自由问答
   │     Claude Agent SDK → Bedrock;降级为关键词 RAG + 模板
   ├── 视觉(vision.ts)—— Bedrock Converse,图片 → 型号/零件
   ├── RAG(rag.ts)—— 向量(Titan)优先,关键词兜底
   └── 实时抓取(liveFetch.ts)—— 目录未命中 → 抓取+写入(proxy-ready)
   │
   ▼
异步 DB 驱动(DB_DRIVER)—— SQLite(开发)/ RDS PostgreSQL(生产)
Amazon Bedrock:Claude Sonnet 4.5(推理 + 视觉)· Titan Embeddings v2
```

**决定一切的核心设计:** 对话是一个显式**状态机**,而 **LLM 只在自然语言真正需要理解的地方被调用**——三个节点。其余环节(菜单、"知道零件号吗"、型号收集、购物车、地址、支付)全部是确定性代码,输出带类型的 UI 事件。结果:一次完整购买流程约 2–4k token(纯 Agent 方案约 20k),固定步骤毫秒级响应,结算流程不可能被模型漂移带偏。状态机和 Agent 调用的是**同一批服务函数**——单一事实来源、两个消费者。

---

## 三、状态机

各阶段(`Session.stage`,见 [session.ts](partselect-agent/src/server/session.ts))及其转移。`⓪`=零 LLM token,`Ⓛ`=LLM 节点,`Ⓥ`=视觉(Bedrock)。

```
                          ┌─────────────┐
   init / submit_image ──►│ await_email │  邮箱 → 载入账号与历史 ⓪Ⓓ
   (任意操作懒建为游客)    └──────┬──────┘  游客 → 新账号;裸邮箱 → 切换
                                 │
                                 ▼
                          ┌─────────────┐   家电卡片(已购/反推)+
                          │    menu     │◄── 三按钮菜单 + 自由输入 + 📷  ⓪
                          └──┬───┬───┬──┘
        ┌────────────────────┘   │   └────────────────────┐
     "损坏"                  "预购"                    "安装"
        │                       │                          │
        ▼                       ▼                          ▼
   需要型号? ──┐      知道零件号吗? ◆            ┌─ 点选已购零件 ⓪
        │ 否   │ 是      是 │      │ 否            └─ 或输入零件号
        ▼      │            ▼      ▼                      │
 ┌────────────┐│      ┌────────────┐ 需要型号             ▼
 │await_model ││      │await_partno│     │           ┌──────────────┐
 └─────┬──────┘│      └─────┬──────┘     ▼           │ install_pick │
       │ ⟦M⟧   │            │ ⟦P⟧  ┌──────────────┐  └──────┬───────┘
       ▼       │            ▼      │await_part_desc│         ▼  ⟦P⟧
 ┌──────────────┐    ┌────────────┐└──────┬───────┘  install_card ⓪Ⓓ
 │await_fault_  │    │  零件卡片  │       │ ⓪→Ⓛ            │
 │   desc       │    │ ⟦P 模块⟧   │       ▼                ▼
 └──────┬───────┘    └─────┬──────┘  零件卡片 ⟦P⟧    ┌────────────┐
        ▼ Ⓛ+RAG            │                          │ install_qa │ Ⓛ
 自助排查步骤 +            │                          └─────┬──────┘
 零件卡片 ⟦P⟧              │                                │ "要订购吗?"
        └──────────────────┴──────────────┬───────────────┘
                                           ▼
                              [ 加入购物车 ](确认制加购)⓪
                                           ▼
                                  ┌─────────────────┐
                                  │ awaiting_confirm│ 订单摘要 ⓪
                                  └────────┬────────┘
                                           ▼ 是
                                  ┌─────────────────┐
                                  │  await_address  │ 表单(预填)⓪
                                  └────────┬────────┘
                                           ▼
                                  ┌─────────────────┐
                                  │  await_payment  │ 演示 Visa(Luhn)⓪
                                  └────────┬────────┘
                                           ▼ 事务:下单 + 扣库存 ⓪Ⓓ
                                    订单确认 → 回主菜单
```

**⟦M 模块⟧(型号查询):** 查到 → 按 intent 续走 · 查不到 →(开启则实时抓取)→ 相近型号 chips → "都不是" → 致歉 → 主菜单。
**⟦P 模块⟧(零件 + 库存):** 有库存 → 卡片含价格 + "加入购物车" · 低库存 → "仅剩 N 件" · 无库存 → 提示 + 替代 · 查不到 →(开启则实时抓取)→ 相近零件 chips → 致歉。

**视觉与自由文本是入口捷径**,不是独立阶段:照片(`submit_image`)或自由文本消息被分类后路由*进入*上面的阶段——例如铭牌照片跳进 ⟦M⟧,"How do I install PS11752778?" 直达 `install_card`,"制冰机不工作" 进入损坏分支。

---

## 四、每个功能是如何实现的

### 4.1 聊天传输与 UI
- **每轮一次 SSE**([api/chat/route.ts](partselect-agent/src/app/api/chat/route.ts)):POST 进一个 `ClientEvent`,处理器以 `data:` 帧流式输出 `ServerEvent`。会话 id 通过 `x-session-id` 响应头下发、客户端带回。
- **带类型协议**([protocol.ts](partselect-agent/src/shared/protocol.ts))前后端共享——`ClientEvent`(用户操作)与 `ServerEvent`(`text`、`agent_delta`、`appliance_cards`、`part_cards`、`install_card`、`cart`、`order_summary`、`address_form`、`payment_form`、`email_form` 等)。新增 UI = 一个类型 + 一个渲染器([Cards.tsx](partselect-agent/src/components/Cards.tsx))+ 一个状态机分支。
- **流式文本**把 `agent_delta` 帧合并进同一个增长气泡([Chat.tsx](partselect-agent/src/components/Chat.tsx))。

### 4.2 身份(邮箱或游客)
- [users.ts](partselect-agent/src/server/services/users.ts) 的 `getOrCreateUserByEmail` 与 `createGuestUser`。会话以 `userId = 0`(未识别)开始。
- 状态机守卫([stateMachine.ts](partselect-agent/src/server/stateMachine.ts))把未识别用户的任意操作**懒建为游客**——绝不拦截。邮箱载入账号;陌生邮箱建档("Welcome / Account created");会话中输入裸邮箱即切换账号。
- 游客就是 `email = NULL` 的普通行,所以游客模式无需改 schema。

### 4.3 个性化与机型反推
- `getAppliances` 把已购/查询过的机器渲染成卡片。
- 对买过零件但没登记机器的用户,`inferModelsFromPurchases` 执行 `已购零件 → 兼容性 → 候选机型,按匹配数排序`,以 "Likely yours" 卡片呈现。
- `profileSummary` 把**一行**画像注入 Agent 上下文,而非回放聊天历史——个性化的 token 成本接近零。

### 4.4 视觉输入 📷
- [vision.ts](partselect-agent/src/server/vision.ts):前端把图片缩到 ≤1024px JPEG,`handleImage` 调用 **Bedrock Converse** 的图像块。模型返回恰好一行——`MODEL: <型号>`、`PART: <描述> | <家电>` 或 `UNCLEAR: <原因>`——路由进 ⟦M 模块⟧ 或零件搜索。
- 范围防护栏延伸到图片:非家电照片返回 `UNCLEAR`。无 LLM → 优雅降级为"请手动输入型号"。

### 4.5 诊断(损坏分支)
- `agentDiagnose`([agent/index.ts](partselect-agent/src/server/agent/index.ts)):先调 `search_repair_guides`(RAG)给自助排查步骤,再调 `search_parts`(限定型号),输出一行 `RECOMMEND:` 零件号,由状态机渲染成卡片。
- **降级模式:** 无 LLM 时退回关键词 RAG(`retrieveChunks`)+ 症状搜索 + 模板话术——每条分支照样跑完。

### 4.6 零件查询、搜索与兼容性
- [catalog.ts](partselect-agent/src/server/services/catalog.ts) 的 `getPartByNo`、`searchParts`(症状加权,可选型号限定)、`checkCompatibility`。
- **兼容性是关系型的、绝不猜测**——读 `compatibility` 联结表。错答一个"是"就是一单退货,所以这是唯一不允许 LLM 即兴发挥的事(由系统提示词与"`check_compatibility` 是唯一兼容性工具"双重强制)。
- 未命中时由前缀递减给出相近匹配(`findSimilarModels` / `findSimilarParts`)。

### 4.7 安装指导
- `getInstallGuide` 返回结构化行(难度、分钟、工具、有序步骤、视频、说明书)。安装分支以**零 token SQL 直查**渲染成卡片;只有模糊追问("要先断水吗?")才进 Agent。

### 4.8 电商(购物车 → 结算 → 支付)
- [orders.ts](partselect-agent/src/server/services/orders.ts):`addToCart` 强制校验库存;`createOrder` 在**单个事务**内——复核库存 → 扣减 → 写订单+明细(`unit_price` 快照)→ 清购物车 → 会话机型升级"已购"。超卖竞态在 DB 层关死。
- [payments.ts](partselect-agent/src/server/services/payments.ts):**仅演示**的 `validateVisa`(4 开头、16 位、Luhn)+ `charge` 返回假凭证——**无真实网关、无真实扣款**。按网关适配器形状设计,换 Stripe 只改一处。
- 库存状态驱动 UI:`lowStock`(≤5 → "仅剩 N 件")、`outOfStock`(禁止加购)、现货标签。

### 4.9 自助保养知识
- 维修/保养 `doc_chunks`(洗碗机滤网清洗、除垢、冷凝器清洁、异味)+ 清洁用品(affresh 清洁片、除垢剂、冷凝器刷)作为真实可购买零件入库——所以"我该怎么清洁?"既给步骤又给商品。

### 4.10 实时兜底与自增长目录
- [liveFetch.ts](partselect-agent/src/server/liveFetch.ts):目录未命中时,`tryLiveModel` / `tryLivePart` 用真实浏览器引擎(Playwright)抓取在线页面,用**采集那 620 个零件时同一套逻辑**解析,`ingestLivePart` / `ensureModel` 写入目录——再从新写入的行作答。
- **诚实的运维现实(已写入文档):** partselect.com 对**数据中心 IP 返回 403**——已验证连 EC2 上的真实无头 Chromium 都被"Access Denied"。所以可靠的实时抓取需要住宅出口(`SCRAPE_PROXY_URL`)。该功能默认关闭(`LIVE_FETCH=1`),被拦截时优雅降级到目录答案;**自有目录**才是让系统稳健的根本。

### 4.11 Agent 层与 MCP 工具
- Agent([agent/index.ts](partselect-agent/src/server/agent/index.ts))在 **Bedrock**(`CLAUDE_CODE_USE_BEDROCK=1`,模型由 `AGENT_MODEL` 指定)上运行 **Claude Agent SDK**(`query()`),模型访问走 AWS IAM——服务链路无第三方 key。
- **9 个只读 MCP 工具**([mcp/index.ts](partselect-agent/src/server/mcp/index.ts)):`search_parts`、`get_part_details`、`check_compatibility`、`search_repair_guides`、`get_install_guide`、`find_similar_models`、`get_parts_for_model`、`get_order_status`、`get_recent_orders`。写操作(加购、下单、扣款)**刻意不是工具**——机制级安全保证,不是提示词承诺。返回值做了裁剪投影以压小上下文。

### 4.12 双层检索(RAG)
- [rag.ts](partselect-agent/src/server/rag.ts):有向量时对 `doc_chunks` 做余弦相似度检索;否则退回关键词搜索——调用方无感。
- [embeddings/provider.ts](partselect-agent/src/server/embeddings/provider.ts):可替换的 `EmbeddingProvider`——生产 **Bedrock Titan v2**(1024 维)、离线可选本地模型、或 `none` → 关键词兜底。`npm run embed` 生成向量。

### 4.13 范围防护栏(三层)
1. **提示词锁定范围**——系统提示词将 Agent 限定在冰箱/洗碗机配件,强制兼容性/诊断必须调用工具。
2. **工具只读**——LLM 物理上无法改写状态。
3. **事实确定性**——兼容性来自 SQL;模型只转述工具结果,绝不编造。超范围文本*与*非家电照片在 LLM 模式和降级模式下都会被拒绝。

### 4.14 真实数据摄入
- [scripts/ingest-real.ts](partselect-agent/scripts/ingest-real.ts) 回放 [data/ingested/](partselect-agent/data/ingested/)——5 个真实型号的完整零件目录(经真实浏览器会话采集)——按零件号 upsert。厂家号撞上真实零件的编造种子号被原地重映射(行 id 不变,订单历史外键完好)。

---

## 五、数据库 schema

**生产跑在 RDS PostgreSQL 上**;SQLite 是零配置的开发/离线默认。应用通过异步驱动([driver.ts](partselect-agent/src/server/db/driver.ts))访问数据库,后端由 `DB_DRIVER`(`pg` 或 `sqlite`)选择;全程方言中立 SQL(`LOWER()=LOWER()` 查询、`?` 占位符、`RETURNING id`、ANSI `ON CONFLICT`),同一套服务代码两个后端通用。Schema:[schema.sql](partselect-agent/src/server/db/schema.sql)(SQLite)·[schema.pg.sql](partselect-agent/src/server/db/schema.pg.sql)(Postgres:`SERIAL`、`TIMESTAMPTZ`、`BYTEA` 向量列)。

```
appliance_models ──< compatibility >── parts ───1:1─── install_guides
      (18)             (938 对)        (664)              (13)
        │                                │ │
        │                                │ └───< doc_chunks(16;可选关联零件,
        │                                │        embedding BLOB → 1024 维 Titan 向量)
        │                                │
        └──< user_appliances >── users   └──< order_items >── orders ──> users
                  (3)           (4 + 游客)      (5)            (4)
                                   │
                                   ├──< search_history(每次查询追加)
                                   └──< carts(结算时清空)
```

每张表为什么这样设计:
- **`parts.stock_qty`** 驱动整个库存体验与下单扣减——库存放数据库而非提示词文本,LLM 永远不可能"卖"没货的零件。**`parts.symptoms`** 让零件可按问题被发现,同时充当排序信号。
- **`compatibility`** 是多对多联结表,因为"适不适配"必须精确;同一张表支撑反向查询(`型号查零件`,以及只买过零件用户的机型反推)。
- **`install_guides`** 是独立的*结构化*表(非文本),所以安装卡片是零 token SQL 直查;视频/说明书 URL 是 payload 不参与 embedding。
- **`doc_chunks`** 是非结构化层——`symptom_tags`、`source_url`+`source_ref`(回答中标注来源)、`embedding` BLOB(pgvector 下变 `vector(1024)`)。结构化事实进 SQL + 模糊知识进向量,正是 Agent 设计在 schema 层的镜像。
- **`order_items.unit_price`** 在下单时刻快照价格;下单是单事务(复核库存 → 扣减 → 写入 → 清购物车),超卖在 DB 层关死。

---

## 六、目录结构

```
partselect-agent/
├── src/app/                # Next.js 页面 + /api/chat SSE 路由
├── src/components/         # Chat.tsx + Cards.tsx(全部消息类型)
├── src/shared/protocol.ts  # 带类型的 ClientEvent / ServerEvent 契约
├── src/server/
│   ├── stateMachine.ts     # 确定性流程核心(M/P 模块、意图、结算)
│   ├── session.ts          # 会话状态(内存 Map;Redis-ready)
│   ├── vision.ts           # Bedrock Converse 图片 → 型号/零件
│   ├── liveFetch.ts        # 目录未命中实时抓取(Playwright,proxy-ready)
│   ├── rag.ts              # 向量优先、关键词兜底检索
│   ├── agent/              # Claude Agent SDK + 降级模式 + 范围防护栏
│   ├── mcp/                # 9 个只读 MCP 工具
│   ├── services/           # catalog · orders · users · payments(事实来源)
│   ├── embeddings/         # Bedrock Titan / 本地 provider 抽象
│   └── db/                 # schema.sql + seed.ts
├── scripts/                # seed · ingest-real · embed · test-flow(43 断言)
└── data/ingested/          # 采集的 partselect.com 真实目录
```

---

## 七、运行

```bash
cd partselect-agent
npm install
npm run db:seed     # SQLite + 合成种子
npm run ingest      # 合并 partselect.com 真实数据 → 18 型号 / 664 零件 / 938 兼容对
npm run dev         # http://localhost:3000(不配任何 key 也完整可用)
npm run test:flow   # 43 项端到端断言
```

可选能力(环境变量):
- `DB_DRIVER=pg` 配 `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` → 跑在 PostgreSQL 上(默认 SQLite)。
- `ANTHROPIC_API_KEY` **或** `CLAUDE_CODE_USE_BEDROCK=1`(+ `AGENT_MODEL`)→ 真实 Claude 推理与视觉。
- `EMBEDDINGS_PROVIDER=bedrock npm run embed` → Titan 向量 RAG。
- `LIVE_FETCH=1`(+ `SCRAPE_PROXY_URL` 住宅代理)→ 实时兜底抓取。

不配任何 key 时,应用仍以 SQLite + 降级模式(关键词 RAG + 模板)端到端运行。

---

## 八、部署

线上 **https://customerservice.lambdapen.com**:EC2 t3.small 用 **systemd** 托管 Next.js,前面是 **nginx**(SSE 关缓冲)+ **Let's Encrypt** 证书,绑弹性 IP;**RDS PostgreSQL** 作为生产数据库(`DB_DRIVER=pg`);**Bedrock**(Claude Sonnet 4.5 + Titan v2)走 IAM 限权凭证。资源清单见 `DEPLOY-INFO.md`。一次性灌数据 = `db:seed → ingest → embed`(对 RDS);日常部署 = 构建 + `systemctl restart partselect`。

**可选下一步:** 把进程内余弦换成真正的 pgvector `vector(1024)` 列 + `<=>` 操作符(当前 BYTEA 向量列可平滑升级)。
