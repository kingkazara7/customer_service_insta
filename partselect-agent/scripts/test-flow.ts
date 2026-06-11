/** 端到端状态机测试:无需 HTTP/LLM,验证 v2 流程图的全部关键路径 */
import { getSession } from "../src/server/session";
import { handleEvent } from "../src/server/stateMachine";
import type { ClientEvent, ServerEvent } from "../src/shared/protocol";

let failures = 0;

async function turn(sessionId: string, ev: ClientEvent): Promise<ServerEvent[]> {
  const out: ServerEvent[] = [];
  await handleEvent(getSession(sessionId), ev, (e) => out.push(e));
  return out;
}

function expect(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`, detail ? JSON.stringify(detail).slice(0, 300) : "");
  }
}

function kinds(evs: ServerEvent[]) { return evs.map((e) => e.kind); }
function texts(evs: ServerEvent[]) {
  // agent_delta 与 text 都算文本输出(LLM 可用与降级两种模式都要能通过)
  return evs
    .filter((e) => e.kind === "text" || e.kind === "agent_delta")
    .map((e) => (e as { text: string }).text)
    .join("\n");
}

async function main() {
  // ── 场景 1:完整购买流程(损坏分支)──
  console.log("场景 1:家电损坏 → 诊断 → 加购 → 结算 → 支付");
  const s1 = getSession().id;
  let evs = await turn(s1, { type: "init" });
  expect("init 返回家电卡片", kinds(evs).includes("appliance_cards"));
  expect("init 返回主菜单", kinds(evs).includes("menu"));

  evs = await turn(s1, { type: "select_appliance", modelNo: "WRS325SDHZ01" });
  expect("选择家电后回菜单", kinds(evs).includes("menu"));

  evs = await turn(s1, { type: "menu_choice", choice: "broken" });
  expect("型号已知,直接要故障描述", texts(evs).includes("故障现象"));

  evs = await turn(s1, { type: "text", text: "制冰机不工作了,完全不出冰" });
  expect("诊断给出排查步骤(RAG)", texts(evs).includes("排查"));
  const cards1 = evs.find((e) => e.kind === "part_cards") as Extract<ServerEvent, { kind: "part_cards" }> | undefined;
  expect("诊断给出推荐零件卡片", !!cards1 && cards1.parts.length > 0, kinds(evs));
  expect("卡片含价格与库存", !!cards1 && cards1.parts.every((p) => p.price > 0 && p.stockQty !== undefined));
  expect("卡片标记与会话型号的兼容性", !!cards1 && cards1.parts.every((p) => p.compatibleWithSessionModel !== null));

  evs = await turn(s1, { type: "add_to_cart", partNo: "PS11749909" });
  expect("加入购物车成功", kinds(evs).includes("cart"));

  evs = await turn(s1, { type: "checkout" });
  expect("结算给出订单摘要", kinds(evs).includes("order_summary"));
  expect("摘要后要求确认", kinds(evs).includes("yesno"));

  evs = await turn(s1, { type: "confirm_order", value: true });
  expect("确认后出地址表单", kinds(evs).includes("address_form"));

  evs = await turn(s1, {
    type: "submit_address",
    address: { name: "King", line1: "1 Demo Rd", city: "Columbus", state: "OH", zip: "43004" },
  });
  expect("地址后出支付表单", kinds(evs).includes("payment_form"));

  evs = await turn(s1, { type: "submit_payment", cardNo: "5555 5555 5555 4444" });
  expect("万事达卡被拒绝", texts(evs).includes("Visa"));

  evs = await turn(s1, { type: "submit_payment", cardNo: "4242 4242 4242 4242" });
  const confirmed = evs.find((e) => e.kind === "order_confirmed") as Extract<ServerEvent, { kind: "order_confirmed" }> | undefined;
  expect("Visa 测试卡支付成功并生成订单", !!confirmed && confirmed.orderId > 0, texts(evs));

  // ── 场景 2:M 模块(型号查不到 → 相近选项 → 选择)──
  console.log("场景 2:相近型号匹配");
  const s2 = getSession().id;
  await turn(s2, { type: "init" });
  await turn(s2, { type: "menu_choice", choice: "broken" });
  evs = await turn(s2, { type: "text", text: "我的型号是 WDT780SAEM9" });
  expect("查不到型号提示 + 相近选项", texts(evs).includes("无法查询到对应型号") && kinds(evs).includes("model_chips"));
  evs = await turn(s2, { type: "select_model", modelNo: "WDT780SAEM1" });
  expect("选择相近型号后继续流程", texts(evs).includes("已确认型号"));

  // ── 场景 3:都不选 → 致歉回主菜单 ──
  evs = await turn(s2, { type: "none_of_these" });
  expect("致歉话术正确", texts(evs).includes("抱歉,我们查询不到您所寻找的配件"));
  expect("回到主菜单", kinds(evs).includes("menu"));

  // ── 场景 4:预购分支(知道零件号 / 缺货)──
  console.log("场景 4:预购 + 库存判定");
  const s4 = getSession().id;
  await turn(s4, { type: "init" });
  await turn(s4, { type: "menu_choice", choice: "preorder" });
  await turn(s4, { type: "know_partno", value: true });
  evs = await turn(s4, { type: "text", text: "PS11754026" });
  expect("零库存零件给出缺货提示", texts(evs).includes("该零件已经没有库存"));
  evs = await turn(s4, { type: "add_to_cart", partNo: "PS11754026" });
  expect("缺货零件不能加购", texts(evs).includes("没有库存"));
  evs = await turn(s4, { type: "text", text: "PS99999999" });
  expect("查不到零件号 → 相近配件或致歉", texts(evs).includes("无法查询到对应配件") || texts(evs).includes("抱歉"));

  // ── 场景 5:安装分支(案例例题 1)──
  console.log("场景 5:安装指导");
  const s5 = getSession().id;
  await turn(s5, { type: "init" });
  evs = await turn(s5, { type: "text", text: "How can I install part number PS11752778?" });
  const install = evs.find((e) => e.kind === "install_card") as Extract<ServerEvent, { kind: "install_card" }> | undefined;
  expect("自由输入直达安装卡片", !!install && install.guide.steps.length > 0, kinds(evs));
  expect("追问是否订购该零件", kinds(evs).includes("yesno"));

  // ── 场景 6:兼容性(案例例题 2,代词消解)──
  console.log("场景 6:兼容性查询");
  evs = await turn(s5, { type: "text", text: "Is this part compatible with my WDT780SAEM1 model?" });
  expect("代词→最近零件,兼容性=否", texts(evs).includes("不兼容"), texts(evs));
  evs = await turn(s5, { type: "text", text: "PS11752778 兼容 WRS325SDHZ01 吗" });
  expect("直接兼容性查询=是", texts(evs).includes("兼容!"), texts(evs));

  // ── 场景 7:范围防护栏 ──
  console.log("场景 7:超范围拒答");
  evs = await turn(s5, { type: "text", text: "给我写一首关于春天的诗" });
  expect("礼貌拒绝超范围请求", texts(evs).includes("只能协助处理冰箱和洗碗机"), texts(evs));

  // ── 场景 8:例题 3(菜单自由输入报修,无型号上下文)──
  console.log("场景 8:报修语义识别");
  const s8 = getSession().id;
  await turn(s8, { type: "init" });
  evs = await turn(s8, { type: "text", text: "The ice maker on my Whirlpool fridge is not working. How can I fix it?" });
  expect("识别报修意图并询问型号", texts(evs).includes("型号"), texts(evs));

  console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
