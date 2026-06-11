import type {
  ClientEvent, ServerEvent, PartCard, CartView, InstallGuideView,
} from "@/shared/protocol";
import { type Session, pushHistory } from "./session";
import {
  getPartByNo, getModelByNo, findSimilarModels, findSimilarParts,
  checkCompatibility, searchParts, getInstallGuide, type Part,
} from "./services/catalog";
import {
  getCart, addToCart, removeFromCart, createOrder,
} from "./services/orders";
import {
  getAppliances, getPurchasedParts, getSavedAddress, recordSearch,
} from "./services/users";
import { charge } from "./services/payments";
import { agentDiagnose, agentMatchParts, agentAnswer, type Emit } from "./agent";

const PART_NO_RE = /PS\d{6,9}/i;
// 家电型号样式:字母开头的 8-14 位字母数字串(如 WDT780SAEM1);排除 PS 零件号
const MODEL_NO_RE = /\b(?!PS\d)[A-Z]{2,4}\d{3}[A-Z0-9]{2,9}\b/i;

const APOLOGY = "抱歉,我们查询不到您所寻找的配件。";

function toCard(p: Part, sessionModelNo?: string): PartCard {
  let compatible: boolean | null = null;
  if (sessionModelNo) {
    compatible = checkCompatibility(p.part_no, sessionModelNo).compatible;
  }
  return {
    partNo: p.part_no,
    mfrPartNo: p.mfr_part_no,
    name: p.name,
    brand: p.brand,
    applianceType: p.appliance_type,
    price: p.price,
    stockQty: p.stock_qty,
    lowStock: p.stock_qty > 0 && p.stock_qty <= 5,
    outOfStock: p.stock_qty <= 0,
    productUrl: p.product_url,
    compatibleWithSessionModel: compatible,
  };
}

function cartView(userId: number): CartView {
  const c = getCart(userId);
  return {
    items: c.items.map((i) => ({
      partNo: i.part_no, name: i.name, price: i.price, qty: i.qty, lineTotal: i.line_total,
    })),
    total: c.total,
    count: c.count,
  };
}

function guideView(g: NonNullable<ReturnType<typeof getInstallGuide>>): InstallGuideView {
  return {
    partNo: g.part_no, partName: g.part_name, difficulty: g.difficulty,
    estTimeMinutes: g.est_time_minutes, tools: g.tools, steps: g.steps,
    videoUrl: g.video_url, manualUrl: g.manual_url,
  };
}

/** ⟦P 模块⟧零件卡片与库存判定:查到有库存→卡片;无库存→提示;查不到→相近选项 */
function emitPartCards(s: Session, emit: Emit, parts: Part[]): void {
  if (parts.length === 0) return;
  s.lastPartNos = parts.map((p) => p.part_no).slice(0, 5);
  emit({ kind: "part_cards", parts: parts.map((p) => toCard(p, s.modelNo)) });
  const oos = parts.filter((p) => p.stock_qty <= 0);
  for (const p of oos) {
    emit({
      kind: "text",
      text: `⚠️ ${p.name}(${p.part_no})该零件已经没有库存,暂时无法订购。到货后我们可以通知您,或者看看上面其他有货的替代零件。`,
    });
  }
}

/** P 模块:按零件号查询的完整判定路径 */
function lookupPartFlow(s: Session, emit: Emit, partNoInput: string): void {
  const part = getPartByNo(partNoInput);
  recordSearch(s.userId, partNoInput, s.modelNo, part?.part_no);
  if (part) {
    emitPartCards(s, emit, [part]);
    return;
  }
  const similar = findSimilarParts(partNoInput);
  if (similar.length > 0) {
    emit({
      kind: "text",
      text: `无法查询到对应配件「${partNoInput}」,以下是相近的配件,看看有没有您要找的:`,
    });
    emit({
      kind: "part_chips",
      parts: similar.map((p) => ({ partNo: p.part_no, name: p.name })),
    });
  } else {
    emit({ kind: "text", text: APOLOGY });
    backToMenu(s, emit);
  }
}

/** ⟦M 模块⟧型号查询:查到→按 intent 续走;查不到→相近选项;都不选→致歉回主菜单 */
function modelLookupFlow(s: Session, emit: Emit, modelInput: string): void {
  const model = getModelByNo(modelInput);
  if (model) {
    s.modelNo = model.model_no;
    s.applianceType = model.appliance_type;
    recordSearch(s.userId, modelInput, model.model_no);
    emit({
      kind: "text",
      text: `✓ 已确认型号:${model.brand} ${model.model_no}${model.name ? `(${model.name})` : ""}`,
    });
    proceedAfterModel(s, emit);
    return;
  }
  const similar = findSimilarModels(modelInput);
  if (similar.length > 0) {
    emit({
      kind: "text",
      text: `无法查询到对应型号「${modelInput}」,以下是相近的型号,请选择:`,
    });
    emit({
      kind: "model_chips",
      models: similar.map((m) => ({ modelNo: m.model_no, brand: m.brand, name: m.name })),
    });
    s.stage = "await_model";
  } else {
    emit({ kind: "text", text: APOLOGY });
    backToMenu(s, emit);
  }
}

function proceedAfterModel(s: Session, emit: Emit): void {
  if (s.intent === "broken") {
    s.stage = "await_fault_desc";
    emit({
      kind: "text",
      text: "请描述一下故障现象(比如:制冰机不出冰、洗完餐具不干、底部积水排不出去……越具体越好):",
    });
  } else if (s.intent === "preorder") {
    s.stage = "await_part_desc";
    emit({
      kind: "text",
      text: "请描述您需要的零件(比如:门上放调料的盒子、下面碗架的轮子……):",
    });
  } else {
    backToMenu(s, emit);
  }
}

function backToMenu(s: Session, emit: Emit): void {
  s.stage = "menu";
  s.intent = undefined;
  emit({ kind: "menu" });
}

function startCheckout(s: Session, emit: Emit): void {
  const cart = cartView(s.userId);
  if (cart.items.length === 0) {
    emit({ kind: "text", text: "您的购物车还是空的,先挑选需要的零件吧。" });
    backToMenu(s, emit);
    return;
  }
  s.stage = "awaiting_confirm";
  emit({ kind: "order_summary", cart, modelNo: s.modelNo });
  emit({
    kind: "yesno",
    id: "confirm_order",
    prompt: `共 ${cart.count} 件零件,合计 $${cart.total.toFixed(2)}。确认这份订单吗?`,
  });
}

/** 主菜单自由输入的确定性意图路由(零 token 捷径优先,兜不住才进 Agent) */
async function routeFreeText(s: Session, emit: Emit, text: string): Promise<void> {
  const partNoMatch = text.match(PART_NO_RE);
  const modelMatch = text.match(MODEL_NO_RE);
  const wantsInstall = /安装|怎么装|如何装|install/i.test(text);
  const wantsCompat = /兼容|适配|适合|匹配|compatible|fit/i.test(text);
  const wantsBroken = /坏|不工作|不制冷|不出冰|不排水|不进水|漏水|异响|修|故障|broken|fix|repair|not working|leak/i.test(text);
  const wantsBuy = /买|购|订购|需要|order|buy|purchase/i.test(text);

  // 捷径 1:零件号 + 安装意图 → 安装卡片
  if (partNoMatch && wantsInstall) {
    s.intent = "install";
    showInstallGuide(s, emit, partNoMatch[0].toUpperCase());
    return;
  }
  // 捷径 2:零件号 + 兼容性(型号取消息里的,或会话上下文的)
  if (partNoMatch && wantsCompat) {
    answerCompatibility(s, emit, partNoMatch[0].toUpperCase(), modelMatch?.[0]?.toUpperCase());
    return;
  }
  // 捷径 3:"这个零件"代词 + 兼容性 → 用最近展示的零件
  if (!partNoMatch && wantsCompat && s.lastPartNos.length > 0) {
    answerCompatibility(s, emit, s.lastPartNos[0], modelMatch?.[0]?.toUpperCase());
    return;
  }
  // 捷径 4:裸零件号 → 零件卡片
  if (partNoMatch) {
    lookupPartFlow(s, emit, partNoMatch[0].toUpperCase());
    return;
  }
  // 捷径 5:报修语义 → 损坏分支(带型号识别)
  if (wantsBroken) {
    s.intent = "broken";
    if (modelMatch) {
      modelLookupFlow(s, emit, modelMatch[0].toUpperCase());
    } else if (s.modelNo) {
      s.stage = "await_fault_desc";
      await handleFaultDesc(s, emit, text); // 描述已经在消息里了,直接诊断
    } else {
      s.stage = "await_model";
      pushHistory(s, "user", text); // 保留故障描述,拿到型号后仍可用
      emit({
        kind: "text",
        text: "好的,先告诉我您的家电型号(机身铭牌上,比如 WDT780SAEM1),我来帮您诊断:",
      });
    }
    return;
  }
  // 捷径 6:购买语义 → 预购分支
  if (wantsBuy) {
    s.intent = "preorder";
    s.stage = "menu";
    emit({
      kind: "yesno",
      id: "know_partno",
      prompt: "您知道零件的 PartSelect 型号吗?(类似 PS11752778)",
    });
    return;
  }
  // 捷径 7:裸型号 → 设为会话上下文
  if (modelMatch && getModelByNo(modelMatch[0])) {
    s.modelNo = modelMatch[0].toUpperCase();
    const m = getModelByNo(s.modelNo)!;
    s.applianceType = m.appliance_type;
    recordSearch(s.userId, text, s.modelNo);
    emit({
      kind: "text",
      text: `✓ 已记住您的家电:${m.brand} ${m.model_no}。需要什么帮助?`,
    });
    emit({ kind: "menu" });
    return;
  }
  // 兜底:Agent 自由问答(范围防护栏内)
  pushHistory(s, "user", text);
  await agentAnswer(s, text, emit);
}

function answerCompatibility(
  s: Session, emit: Emit, partNo: string, modelNoArg?: string
): void {
  const modelNo = modelNoArg ?? s.modelNo;
  if (!modelNo) {
    s.stage = "await_model";
    s.intent = s.intent ?? "preorder";
    s.lastPartNos = [partNo];
    emit({
      kind: "text",
      text: "请告诉我您的家电型号(机身铭牌上),我来帮您核对兼容性:",
    });
    return;
  }
  const r = checkCompatibility(partNo, modelNo);
  recordSearch(s.userId, `compat ${partNo} ${modelNo}`, modelNo, partNo);
  if (!r.partFound) {
    lookupPartFlow(s, emit, partNo);
    return;
  }
  if (!r.modelFound) {
    s.intent = s.intent ?? "preorder";
    modelLookupFlow(s, emit, modelNo);
    return;
  }
  if (r.compatible) {
    emit({
      kind: "text",
      text: `✅ 兼容!${r.part!.name}(${partNo})适配您的 ${r.model!.brand} ${r.model!.model_no}。`,
    });
    emitPartCards(s, emit, [r.part!]);
  } else {
    emit({
      kind: "text",
      text: `❌ 不兼容:${r.part!.name}(${partNo})不适配 ${r.model!.brand} ${r.model!.model_no}(它是${r.part!.appliance_type === "refrigerator" ? "冰箱" : "洗碗机"}零件)。需要的话我可以帮您找适配 ${r.model!.model_no} 的零件。`,
    });
  }
}

function showInstallGuide(s: Session, emit: Emit, partNo: string): void {
  const part = getPartByNo(partNo);
  if (!part) {
    lookupPartFlow(s, emit, partNo);
    return;
  }
  const guide = getInstallGuide(partNo);
  s.installPartNo = part.part_no;
  s.lastPartNos = [part.part_no]; // 供"这个零件兼容吗"等代词消解
  recordSearch(s.userId, `install ${partNo}`, s.modelNo, part.part_no);
  if (guide) {
    emit({ kind: "install_card", guide: guideView(guide) });
    s.stage = "install_qa";
    emit({
      kind: "yesno",
      id: "order_part",
      prompt: "安装中有任何问题可以直接问我。还需要订购这个零件吗?",
      partNo: part.part_no,
    });
  } else {
    emit({
      kind: "text",
      text: `${part.name}(${partNo})暂时没有图文安装指南,您可以直接问我安装问题,我会从维修资料中帮您查找。`,
    });
    s.stage = "install_qa";
  }
}

async function handleFaultDesc(s: Session, emit: Emit, text: string): Promise<void> {
  pushHistory(s, "user", text);
  recordSearch(s.userId, text, s.modelNo);
  const partNos = await agentDiagnose(s, text, emit);
  const parts = partNos
    .map((no) => getPartByNo(no))
    .filter((p): p is Part => !!p);
  if (parts.length > 0) {
    emitPartCards(s, emit, parts);
    emit({
      kind: "text",
      text: "确认需要后点击卡片上的「加入购物车」即可。还有其他症状也可以继续描述。",
    });
  } else {
    emit({
      kind: "text",
      text: "根据您的描述暂时定位不到需要更换的零件。可以补充更多细节,或者换一种说法描述故障。",
    });
  }
}

/** 状态机主入口 */
export async function handleEvent(
  s: Session,
  ev: ClientEvent,
  emit: Emit
): Promise<void> {
  switch (ev.type) {
    case "init": {
      const appliances = getAppliances(s.userId);
      emit({
        kind: "text",
        text: "👋 您好!我是 PartSelect 配件助手,可以帮您诊断冰箱/洗碗机故障、查找和订购零件、指导安装。",
      });
      if (appliances.length > 0) {
        emit({
          kind: "appliance_cards",
          appliances: appliances.map((a) => ({
            modelNo: a.model_no, brand: a.brand,
            applianceType: a.appliance_type, name: a.name, source: a.source,
          })),
        });
        emit({ kind: "text", text: "点击选择您的家电,或直接在下方输入问题:" });
      }
      emit({ kind: "menu" });
      s.stage = "menu";
      break;
    }

    case "select_appliance": {
      const m = getModelByNo(ev.modelNo);
      if (m) {
        s.modelNo = m.model_no;
        s.applianceType = m.appliance_type;
        emit({
          kind: "text",
          text: `✓ 已选择:${m.brand} ${m.model_no}${m.name ? `(${m.name})` : ""}。请问需要什么帮助?`,
        });
      }
      emit({ kind: "menu" });
      s.stage = "menu";
      break;
    }

    case "menu_choice": {
      s.intent = ev.choice;
      if (ev.choice === "broken") {
        if (!s.modelNo) {
          s.stage = "await_model";
          emit({
            kind: "text",
            text: "请告诉我您的家电型号(机身铭牌上,比如 WDT780SAEM1):",
          });
        } else {
          proceedAfterModel(s, emit);
        }
      } else if (ev.choice === "preorder") {
        emit({
          kind: "yesno",
          id: "know_partno",
          prompt: "您知道零件的 PartSelect 型号吗?(类似 PS11752778)",
        });
      } else {
        // install
        s.stage = "install_pick";
        const purchased = getPurchasedParts(s.userId);
        if (purchased.length > 0) {
          emit({ kind: "text", text: "请输入零件号,或直接选择您之前购买过的零件:" });
          emit({
            kind: "purchased_part_chips",
            parts: purchased.map((p) => ({ partNo: p.part_no, name: p.name })),
          });
        } else {
          emit({ kind: "text", text: "请输入零件号(如 PS11752778),我来调出安装指南:" });
        }
      }
      break;
    }

    case "know_partno": {
      s.intent = "preorder";
      if (ev.value) {
        s.stage = "await_partno";
        emit({ kind: "text", text: "请输入零件号(如 PS11752778):" });
      } else if (!s.modelNo) {
        s.stage = "await_model";
        emit({
          kind: "text",
          text: "没关系。请先告诉我您的家电型号(机身铭牌上),我根据描述帮您找:",
        });
      } else {
        proceedAfterModel(s, emit);
      }
      break;
    }

    case "select_model": {
      modelLookupFlow(s, emit, ev.modelNo);
      break;
    }

    case "select_part": {
      if (s.intent === "install" || s.stage === "install_pick" || s.stage === "install_qa") {
        showInstallGuide(s, emit, ev.partNo);
      } else {
        lookupPartFlow(s, emit, ev.partNo);
      }
      break;
    }

    case "none_of_these": {
      emit({ kind: "text", text: APOLOGY });
      backToMenu(s, emit);
      break;
    }

    case "add_to_cart": {
      const r = addToCart(s.userId, ev.partNo, ev.qty ?? 1);
      if (r.ok) {
        emit({ kind: "text", text: "✅ 已加入购物车。" });
        emit({ kind: "cart", cart: cartView(s.userId) });
      } else if (r.reason === "out_of_stock") {
        emit({ kind: "text", text: "该零件已经没有库存,暂时无法订购。" });
      } else if (r.reason === "insufficient_stock") {
        emit({ kind: "text", text: "库存不足,无法再增加数量。" });
      } else {
        emit({ kind: "text", text: APOLOGY });
      }
      break;
    }

    case "remove_from_cart": {
      removeFromCart(s.userId, ev.partNo);
      emit({ kind: "cart", cart: cartView(s.userId) });
      break;
    }

    case "checkout": {
      startCheckout(s, emit);
      break;
    }

    case "confirm_order": {
      if (s.stage !== "awaiting_confirm") break;
      if (ev.value) {
        s.stage = "await_address";
        emit({ kind: "text", text: "请填写收货地址:" });
        emit({ kind: "address_form", saved: getSavedAddress(s.userId) as never });
      } else {
        emit({ kind: "text", text: "好的,订单未提交。您可以继续挑选或修改购物车。" });
        backToMenu(s, emit);
      }
      break;
    }

    case "submit_address": {
      if (s.stage !== "await_address") break;
      s.pendingAddress = ev.address;
      s.stage = "await_payment";
      const cart = cartView(s.userId);
      emit({
        kind: "text",
        text: "地址已保存。最后一步,请输入支付卡号(演示环境:任意能通过校验的 Visa 卡号即可,如 4242 4242 4242 4242):",
      });
      emit({ kind: "payment_form", total: cart.total });
      break;
    }

    case "submit_payment": {
      if (s.stage !== "await_payment" || !s.pendingAddress) break;
      const cart = cartView(s.userId);
      const pay = charge(ev.cardNo, cart.total);
      if (!pay.ok) {
        emit({ kind: "text", text: `❌ 支付失败:${pay.reason}。请重新输入卡号:` });
        emit({ kind: "payment_form", total: cart.total });
        break;
      }
      const order = createOrder(s.userId, s.pendingAddress, pay.last4, s.modelNo);
      if (!order.ok) {
        const msg =
          order.reason === "insufficient_stock"
            ? `很抱歉,以下零件刚刚被买完了:${(order.outOfStock ?? []).join(", ")}。订单未提交,请调整购物车。`
            : "订单提交失败,请重试。";
        emit({ kind: "text", text: msg });
        backToMenu(s, emit);
        break;
      }
      emit({
        kind: "order_confirmed",
        orderId: order.orderId,
        total: order.total,
        last4: pay.last4,
        receiptId: pay.receiptId,
      });
      emit({
        kind: "text",
        text: `🎉 订单 #${order.orderId} 已确认,合计 $${order.total.toFixed(2)}(尾号 ${pay.last4})。零件将尽快发出,您可以随时回来问我订单状态或安装方法。`,
      });
      s.pendingAddress = undefined;
      backToMenu(s, emit);
      break;
    }

    case "order_part": {
      if (ev.value) {
        const part = getPartByNo(ev.partNo);
        if (part) emitPartCards(s, emit, [part]);
      } else {
        emit({ kind: "text", text: "好的,祝您安装顺利!有问题随时回来找我。" });
        backToMenu(s, emit);
      }
      break;
    }

    case "back_to_menu": {
      backToMenu(s, emit);
      break;
    }

    case "text": {
      const text = ev.text.trim();
      if (!text) break;
      switch (s.stage) {
        case "await_model": {
          const m = text.match(MODEL_NO_RE);
          modelLookupFlow(s, emit, (m?.[0] ?? text).toUpperCase());
          break;
        }
        case "await_fault_desc": {
          await handleFaultDesc(s, emit, text);
          break;
        }
        case "await_partno": {
          const m = text.match(PART_NO_RE);
          lookupPartFlow(s, emit, (m?.[0] ?? text).toUpperCase());
          break;
        }
        case "await_part_desc": {
          pushHistory(s, "user", text);
          recordSearch(s.userId, text, s.modelNo);
          // 先确定性精确搜索(零 token),无果才进 Agent
          const hits = searchParts({
            query: text,
            applianceType: s.applianceType,
            modelNo: s.modelNo,
            limit: 3,
          });
          if (hits.length > 0) {
            emit({ kind: "text", text: "为您找到以下匹配零件:" });
            emitPartCards(s, emit, hits);
            emit({ kind: "text", text: "确认后点击「加入购物车」,或继续描述其他零件。" });
          } else {
            const partNos = await agentMatchParts(s, text, emit);
            const parts = partNos.map((no) => getPartByNo(no)).filter((p): p is Part => !!p);
            if (parts.length > 0) {
              emitPartCards(s, emit, parts);
            } else {
              emit({ kind: "text", text: APOLOGY });
              backToMenu(s, emit);
            }
          }
          break;
        }
        case "install_pick": {
          const m = text.match(PART_NO_RE);
          if (m) {
            showInstallGuide(s, emit, m[0].toUpperCase());
          } else {
            await agentAnswer(s, text, emit);
          }
          break;
        }
        case "install_qa": {
          // 兼容性/零件号等确定性捷径优先,纯安装追问才进 Agent
          await routeFreeText(s, emit, text);
          break;
        }
        case "await_address":
        case "await_payment":
        case "awaiting_confirm": {
          emit({
            kind: "text",
            text: "请先完成上方的当前步骤;想取消可以点「返回主菜单」。",
          });
          break;
        }
        default: {
          await routeFreeText(s, emit, text);
        }
      }
      break;
    }
  }
  emit({ kind: "done" });
}
