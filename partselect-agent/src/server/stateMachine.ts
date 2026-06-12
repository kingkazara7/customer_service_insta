import type {
  ClientEvent, ServerEvent, PartCard, CartView, InstallGuideView,
} from "@/shared/protocol";
import { type Session, pushHistory } from "./session";
import {
  getPartByNo, getModelByNo, findSimilarModels, findSimilarParts,
  checkCompatibility, searchParts, getInstallGuide, type Part,
  ingestLivePart, ensureModel,
} from "./services/catalog";
import { fetchModel, fetchPart } from "./liveFetch";
import {
  getCart, addToCart, removeFromCart, createOrder,
} from "./services/orders";
import {
  getAppliances, getPurchasedParts, getSavedAddress, recordSearch,
  getOrCreateUserByEmail, createGuestUser, inferModelsFromPurchases,
  upsertAppliance,
} from "./services/users";
import { charge } from "./services/payments";
import { agentDiagnose, agentMatchParts, agentAnswer, type Emit } from "./agent";
import { identifyImage } from "./vision";

const PART_NO_RE = /PS\d{6,9}/i;
// Appliance model pattern: letters followed by digits, 8-14 chars (e.g. WDT780SAEM1).
// Negative lookahead excludes PS part numbers.
const MODEL_NO_RE = /\b(?!PS\d)[A-Z]{2,4}\d{3}[A-Z0-9]{2,9}\b/i;

const APOLOGY = "Sorry, we couldn't find the part you're looking for.";
const OUT_OF_SCOPE_MSG =
  "Sorry, I can only help with refrigerator and dishwasher parts.";
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;

// Appliances we explicitly do NOT serve. High-confidence terms only, to avoid
// false positives (e.g. "washer" is skipped — it's also a ring-shaped part, and
// "dishwasher" contains it). "freezer" is intentionally absent (part of a fridge).
const OUT_OF_SCOPE_RE =
  /air[\s-]?con|\bdryer|washing machine|clothes washer|\blaundry\b|\boven\b|\bstove\b|microwave|water heater|garbage disposal|\bfurnace|\btoaster|\bblender|\bgrill\b/i;

/**
 * Deflect non-refrigerator/dishwasher appliances before the deterministic
 * intent shortcuts (buy/repair) can route them. A part number or known model in
 * the message overrides this — those are unambiguously in-catalog.
 */
function isOutOfScope(text: string): boolean {
  if (PART_NO_RE.test(text)) return false;
  return OUT_OF_SCOPE_RE.test(text);
}

function deflectOutOfScope(s: Session, emit: Emit): void {
  emit({ kind: "text", text: OUT_OF_SCOPE_MSG });
  backToMenu(s, emit);
}

/** Infer the appliance type from free text (used when the user describes instead of giving a model). */
function detectApplianceType(text: string): "refrigerator" | "dishwasher" | undefined {
  if (/dish ?washer|\bdish\b/i.test(text)) return "dishwasher";
  if (/refriger|\bfridge\b|freezer|ice ?maker|water ?filter|crisper/i.test(text)) return "refrigerator";
  return undefined;
}

function applianceTypeName(t: string): string {
  return t === "refrigerator" ? "refrigerator" : "dishwasher";
}

async function toCard(p: Part, sessionModelNo?: string): Promise<PartCard> {
  let compatible: boolean | null = null;
  if (sessionModelNo) {
    compatible = (await checkCompatibility(p.part_no, sessionModelNo)).compatible;
  }
  return {
    partNo: p.part_no,
    mfrPartNo: p.mfr_part_no,
    name: p.name,
    brand: p.brand,
    applianceType: p.appliance_type,
    price: Number(p.price),
    stockQty: p.stock_qty,
    lowStock: p.stock_qty > 0 && p.stock_qty <= 5,
    outOfStock: p.stock_qty <= 0,
    productUrl: p.product_url,
    compatibleWithSessionModel: compatible,
  };
}

async function cartView(userId: number): Promise<CartView> {
  const c = await getCart(userId);
  return {
    items: c.items.map((i) => ({
      partNo: i.part_no, name: i.name, price: i.price, qty: i.qty, lineTotal: i.line_total,
    })),
    total: c.total,
    count: c.count,
  };
}

function guideView(g: NonNullable<Awaited<ReturnType<typeof getInstallGuide>>>): InstallGuideView {
  return {
    partNo: g.part_no, partName: g.part_name, difficulty: g.difficulty,
    estTimeMinutes: g.est_time_minutes, tools: g.tools, steps: g.steps,
    videoUrl: g.video_url, manualUrl: g.manual_url,
  };
}

/** P module: part cards with stock states (in stock → card; out of stock → notice) */
async function emitPartCards(s: Session, emit: Emit, parts: Part[]): Promise<void> {
  if (parts.length === 0) return;
  s.lastPartNos = parts.map((p) => p.part_no).slice(0, 5);
  emit({ kind: "part_cards", parts: await Promise.all(parts.map((p) => toCard(p, s.modelNo))) });
  const oos = parts.filter((p) => p.stock_qty <= 0);
  for (const p of oos) {
    emit({
      kind: "text",
      text: `⚠️ ${p.name} (${p.part_no}) is currently out of stock and can't be ordered right now. We can notify you when it's back in stock, or take a look at an in-stock alternative above.`,
    });
  }
}

/** P module: full lookup path for a part number */
async function lookupPartFlow(s: Session, emit: Emit, partNoInput: string): Promise<void> {
  const part = await getPartByNo(partNoInput);
  await recordSearch(s.userId, partNoInput, s.modelNo, part?.part_no);
  if (part) {
    await emitPartCards(s, emit, [part]);
    return;
  }
  // Not in the local catalog → try a live fetch from partselect.com before giving up
  if (await tryLivePart(s, emit, partNoInput)) return;
  const similar = await findSimilarParts(partNoInput);
  if (similar.length > 0) {
    emit({
      kind: "text",
      text: `We couldn't find part "${partNoInput}". Here are some close matches — is one of these what you're looking for?`,
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

/** Live fallback for a part number: fetch from partselect, ingest, then show it. */
async function tryLivePart(s: Session, emit: Emit, partNo: string): Promise<boolean> {
  if (process.env.LIVE_FETCH !== "1") return false;
  emit({ kind: "text", text: `Let me check PartSelect directly for ${partNo}…` });
  const live = await fetchPart(partNo);
  if (!live || !live.appliance_type) return false;
  await ingestLivePart({
    part_no: live.ps, mfr_part_no: live.mfr, name: live.name,
    description: live.description, appliance_type: live.appliance_type,
    brand: null, price: live.price, stock: live.stock, product_url: live.url,
    modelNo: s.modelNo,
  });
  const part = await getPartByNo(live.ps);
  if (!part) return false;
  emit({ kind: "text", text: "Found it on PartSelect — added to our catalog:" });
  await emitPartCards(s, emit, [part]);
  return true;
}

/** Live fallback for a model: fetch its parts catalog, ingest, then continue. */
async function tryLiveModel(s: Session, emit: Emit, modelNo: string): Promise<boolean> {
  if (process.env.LIVE_FETCH !== "1") return false;
  emit({ kind: "text", text: `Let me check PartSelect directly for model ${modelNo}…` });
  const live = await fetchModel(modelNo);
  if (!live) return false;
  await ensureModel(live.modelNo, live.brand, live.appliance_type);
  for (const p of live.parts) {
    await ingestLivePart({
      part_no: p.ps, mfr_part_no: p.mfr, name: p.name,
      appliance_type: live.appliance_type, brand: live.brand,
      price: p.price, stock: p.stock,
      product_url: `https://www.partselect.com/${p.ps}-${p.slug}.htm`,
      modelNo: live.modelNo,
    });
  }
  emit({
    kind: "text",
    text: `Found your ${live.brand} ${live.modelNo} on PartSelect and loaded ${live.parts.length} compatible parts.`,
  });
  return true;
}

/** M module: model lookup → found: continue by intent; not found: similar options; none → apology */
async function modelLookupFlow(s: Session, emit: Emit, modelInput: string): Promise<void> {
  let model = await getModelByNo(modelInput);
  if (!model && (await tryLiveModel(s, emit, modelInput))) {
    model = await getModelByNo(modelInput);
  }
  if (model) {
    s.modelNo = model.model_no;
    s.applianceType = model.appliance_type;
    await recordSearch(s.userId, modelInput, model.model_no);
    emit({
      kind: "text",
      text: `✓ Model confirmed: ${model.brand} ${model.model_no}${model.name ? ` (${model.name})` : ""}`,
    });
    proceedAfterModel(s, emit);
    return;
  }
  const similar = await findSimilarModels(modelInput);
  if (similar.length > 0) {
    emit({
      kind: "text",
      text: `We couldn't find model "${modelInput}". Here are some close matches — please pick yours:`,
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
      text: "Please describe the problem (e.g. ice maker not making ice, dishes come out wet, standing water in the bottom… the more specific, the better):",
    });
  } else if (s.intent === "preorder") {
    s.stage = "await_part_desc";
    emit({
      kind: "text",
      text: "Please describe the part you need (e.g. the bin on the door that holds condiments, the wheel on the lower rack…):",
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

async function startCheckout(s: Session, emit: Emit): Promise<void> {
  const cart = await cartView(s.userId);
  if (cart.items.length === 0) {
    emit({ kind: "text", text: "Your cart is empty — let's find the parts you need first." });
    backToMenu(s, emit);
    return;
  }
  s.stage = "awaiting_confirm";
  emit({ kind: "order_summary", cart, modelNo: s.modelNo });
  emit({
    kind: "yesno",
    id: "confirm_order",
    prompt: `${cart.count} item${cart.count > 1 ? "s" : ""}, total $${cart.total.toFixed(2)}. Place this order?`,
  });
}

/** Deterministic intent routing for free text (zero-token shortcuts first, agent as fallback) */
async function routeFreeText(s: Session, emit: Emit, text: string): Promise<void> {
  // A bare email at any point switches/loads the account (guest → identified)
  if (EMAIL_RE.test(text) && text.trim().split(/\s+/).length <= 3) {
    await identifyUser(s, emit, text);
    return;
  }
  const partNoMatch = text.match(PART_NO_RE);
  const modelMatch = text.match(MODEL_NO_RE);
  const wantsInstall = /install|installation/i.test(text);
  const wantsCompat = /compatib|\bfits?\b|work(s)? with|right for/i.test(text);
  const wantsBroken =
    /broken|not working|won'?t|doesn'?t|stopped|stuck|fix|repair|leak|nois[ye]|not cooling|not draining|not drying|no ice|error code|clog|smell|odor|how (do|can) i clean|self.?clean/i.test(text);
  const wantsBuy = /\bbuy\b|\border\b|purchase|replacement|looking for|need a/i.test(text);

  // Shortcut 1: part number + install intent → installation card
  if (partNoMatch && wantsInstall) {
    s.intent = "install";
    await showInstallGuide(s, emit, partNoMatch[0].toUpperCase());
    return;
  }
  // Shortcut 2: part number + compatibility (model from message or session context)
  if (partNoMatch && wantsCompat) {
    await answerCompatibility(s, emit, partNoMatch[0].toUpperCase(), modelMatch?.[0]?.toUpperCase());
    return;
  }
  // Shortcut 3: pronoun ("this part") + compatibility → most recently shown part
  if (!partNoMatch && wantsCompat && s.lastPartNos.length > 0) {
    await answerCompatibility(s, emit, s.lastPartNos[0], modelMatch?.[0]?.toUpperCase());
    return;
  }
  // Scope guard: deflect non-fridge/dishwasher appliances before buy/repair
  // shortcuts route them (a part number in the message overrides this).
  if (isOutOfScope(text)) {
    deflectOutOfScope(s, emit);
    return;
  }
  // Shortcut 4: bare part number → part card
  if (partNoMatch) {
    await lookupPartFlow(s, emit, partNoMatch[0].toUpperCase());
    return;
  }
  // Shortcut 5: repair phrasing → broken branch (with model detection)
  if (wantsBroken) {
    s.intent = "broken";
    if (modelMatch) {
      await modelLookupFlow(s, emit, modelMatch[0].toUpperCase());
    } else if (s.modelNo) {
      s.stage = "await_fault_desc";
      await handleFaultDesc(s, emit, text); // the message already contains the symptom
    } else {
      s.stage = "await_model";
      pushHistory(s, "user", text); // keep the symptom; still useful once we have the model
      emit({
        kind: "text",
        text: "Got it. First, what's your appliance's model number? (on the nameplate — e.g. WDT780SAEM1) Then I'll help you diagnose it:",
      });
    }
    return;
  }
  // Shortcut 6: purchase phrasing → pre-order branch
  if (wantsBuy) {
    s.intent = "preorder";
    s.stage = "menu";
    emit({
      kind: "yesno",
      id: "know_partno",
      prompt: "Do you know the PartSelect part number? (it looks like PS11752778)",
    });
    return;
  }
  // Shortcut 7: bare model number → set session context
  const bareModel = modelMatch ? await getModelByNo(modelMatch[0]) : undefined;
  if (bareModel) {
    s.modelNo = bareModel.model_no;
    s.applianceType = bareModel.appliance_type;
    await recordSearch(s.userId, text, s.modelNo);
    emit({
      kind: "text",
      text: `✓ Got it — your appliance is the ${bareModel.brand} ${bareModel.model_no}. What do you need?`,
    });
    emit({ kind: "menu" });
    return;
  }
  // Fallback: agent free-form answer (within the scope guardrail)
  pushHistory(s, "user", text);
  await agentAnswer(s, text, emit);
}

async function answerCompatibility(
  s: Session, emit: Emit, partNo: string, modelNoArg?: string
): Promise<void> {
  const modelNo = modelNoArg ?? s.modelNo;
  if (!modelNo) {
    s.stage = "await_model";
    s.intent = s.intent ?? "preorder";
    s.lastPartNos = [partNo];
    emit({
      kind: "text",
      text: "Sure — what's your appliance's model number? (on the nameplate) I'll check compatibility:",
    });
    return;
  }
  const r = await checkCompatibility(partNo, modelNo);
  await recordSearch(s.userId, `compat ${partNo} ${modelNo}`, modelNo, partNo);
  if (!r.partFound) {
    await lookupPartFlow(s, emit, partNo);
    return;
  }
  if (!r.modelFound) {
    s.intent = s.intent ?? "preorder";
    await modelLookupFlow(s, emit, modelNo);
    return;
  }
  if (r.compatible) {
    emit({
      kind: "text",
      text: `✅ Compatible! The ${r.part!.name} (${partNo}) fits your ${r.model!.brand} ${r.model!.model_no}.`,
    });
    await emitPartCards(s, emit, [r.part!]);
  } else {
    emit({
      kind: "text",
      text: `❌ Not compatible: the ${r.part!.name} (${partNo}) does not fit the ${r.model!.brand} ${r.model!.model_no} — it's a ${applianceTypeName(r.part!.appliance_type)} part. I can help you find parts that do fit the ${r.model!.model_no} if you'd like.`,
    });
  }
}

async function showInstallGuide(s: Session, emit: Emit, partNo: string): Promise<void> {
  const part = await getPartByNo(partNo);
  if (!part) {
    await lookupPartFlow(s, emit, partNo);
    return;
  }
  const guide = await getInstallGuide(partNo);
  s.installPartNo = part.part_no;
  s.lastPartNos = [part.part_no]; // enables pronoun resolution ("is this part compatible…")
  await recordSearch(s.userId, `install ${partNo}`, s.modelNo, part.part_no);
  if (guide) {
    emit({ kind: "install_card", guide: guideView(guide) });
    s.stage = "install_qa";
    emit({
      kind: "yesno",
      id: "order_part",
      prompt: "Feel free to ask me anything about the installation. Would you also like to order this part?",
      partNo: part.part_no,
    });
  } else {
    emit({
      kind: "text",
      text: `${part.name} (${partNo}) doesn't have a step-by-step guide yet, but you can ask me installation questions and I'll search our repair materials.`,
    });
    s.stage = "install_qa";
  }
}

/** Pre-order branch: match a part from a free-text description (exact search first, agent on miss). */
async function handlePartDesc(s: Session, emit: Emit, text: string): Promise<void> {
  pushHistory(s, "user", text);
  await recordSearch(s.userId, text, s.modelNo);
  // Deterministic search first (zero tokens); the agent only runs if it finds nothing
  const hits = await searchParts({
    query: text,
    applianceType: s.applianceType,
    modelNo: s.modelNo,
    limit: 3,
  });
  if (hits.length > 0) {
    emit({ kind: "text", text: "Here's what matches your description:" });
    await emitPartCards(s, emit, hits);
    emit({
      kind: "text",
      text: "Tap “Add to Cart” to confirm, or keep describing other parts you need.",
    });
    return;
  }
  const partNos = await agentMatchParts(s, text, emit);
  const parts = (await Promise.all(partNos.map((no) => getPartByNo(no)))).filter((p): p is Part => !!p);
  if (parts.length > 0) {
    await emitPartCards(s, emit, parts);
  } else {
    emit({ kind: "text", text: APOLOGY });
    backToMenu(s, emit);
  }
}

async function handleFaultDesc(s: Session, emit: Emit, text: string): Promise<void> {
  pushHistory(s, "user", text);
  await recordSearch(s.userId, text, s.modelNo);
  const partNos = await agentDiagnose(s, text, emit);
  const parts = (await Promise.all(partNos.map((no) => getPartByNo(no))))
    .filter((p): p is Part => !!p);
  if (parts.length > 0) {
    await emitPartCards(s, emit, parts);
    emit({
      kind: "text",
      text: "Once you've confirmed a part, tap “Add to Cart” on its card. You can also keep describing other symptoms.",
    });
  } else {
    emit({
      kind: "text",
      text: "I couldn't pinpoint a replacement part from that description. Could you add a bit more detail or describe it differently?",
    });
  }
}

/**
 * Vision entry: a customer photographed their appliance nameplate.
 * Scoped to reading the MODEL NUMBER (a reliable OCR task), then routes into
 * the M-module. We don't try to identify a part from its appearance — that's
 * unreliable for any vision model, so unclear photos ask the user to type it.
 */
async function handleImage(
  s: Session, emit: Emit, base64: string, format: "jpeg" | "png" | "gif" | "webp"
): Promise<void> {
  emit({ kind: "text", text: "📷 Reading the model number from your photo…" });
  const result = await identifyImage({ base64, format });

  if (result.kind === "model") {
    emit({
      kind: "text",
      text: `I read the model number **${result.modelNo}** from your photo. Let me check it…`,
    });
    // Reuse the M-module: handles found / similar-options / apology
    await modelLookupFlow(s, emit, result.modelNo);
    return;
  }

  // unclear → ask the user to type it
  emit({ kind: "text", text: result.reason });
}

/** Post-identification home: personalized appliance cards + main menu */
async function emitHome(s: Session, emit: Emit): Promise<void> {
  // Only "purchased" (confirmed-owned) appliances are shown as the user's machines
  // and suppress inference. A "searched" row is ephemeral session memory — it must
  // not turn the appliance-inference experience into a single stale card.
  const owned = (await getAppliances(s.userId)).filter((a) => a.source === "purchased");
  if (owned.length > 0) {
    emit({
      kind: "appliance_cards",
      appliances: owned.map((a) => ({
        modelNo: a.model_no, brand: a.brand,
        applianceType: a.appliance_type, name: a.name, source: a.source,
      })),
    });
    emit({ kind: "text", text: "Pick your appliance, or just type your question below:" });
  } else {
    // Customers who bought parts but never registered a machine:
    // infer likely models from part compatibility and offer them
    const inferred = await inferModelsFromPurchases(s.userId);
    if (inferred.length > 0) {
      emit({
        kind: "text",
        text: "Based on the parts you've purchased, your appliance is likely one of these — pick yours and I can find matching parts right away:",
      });
      emit({
        kind: "appliance_cards",
        appliances: inferred.map((m) => ({
          modelNo: m.model_no, brand: m.brand,
          applianceType: m.appliance_type, name: m.name, source: "inferred" as const,
        })),
      });
    }
  }
  emit({ kind: "menu" });
  s.stage = "menu";
}

/** Lazy guest creation: an unidentified user who just starts talking becomes a guest */
async function ensureUser(s: Session, emit: Emit): Promise<void> {
  if (s.userId !== 0) return;
  s.userId = await createGuestUser();
  emit({
    kind: "text",
    text: "Continuing as a guest — everything works, I just won't have your purchase history. You can type your email anytime to load it.",
  });
}

/** Email identification: load the account and its purchase history, or create one */
async function identifyUser(s: Session, emit: Emit, emailRaw: string): Promise<void> {
  const match = emailRaw.match(EMAIL_RE);
  if (!match) {
    emit({
      kind: "text",
      text: "That doesn't look like a valid email address — please try again, or continue as a guest:",
    });
    emit({ kind: "email_form" });
    s.stage = "await_email";
    return;
  }
  const user = await getOrCreateUserByEmail(match[0]);
  s.userId = user.id;
  if (user.isNew) {
    emit({
      kind: "text",
      text: `✓ Account created for ${match[0].toLowerCase()}. Welcome to PartSelect! How can I help you today?`,
    });
  } else {
    emit({
      kind: "text",
      text: `👋 Welcome back${user.name ? `, ${user.name}` : ""}! I've loaded your purchase history.`,
    });
  }
  await emitHome(s, emit);
}

/** State machine entry point */
export async function handleEvent(
  s: Session,
  ev: ClientEvent,
  emit: Emit
): Promise<void> {
  // Identity is optional: carts and orders need an account, so unidentified
  // users are lazily promoted to a guest account instead of being blocked
  if (s.userId === 0 && ev.type !== "init" && ev.type !== "submit_email") {
    if (ev.type === "continue_guest") {
      await ensureUser(s, emit);
      await emitHome(s, emit);
      emit({ kind: "done" });
      return;
    }
    if (ev.type === "text" && s.stage === "await_email" && EMAIL_RE.test(ev.text)) {
      await identifyUser(s, emit, ev.text);
      emit({ kind: "done" });
      return;
    }
    // Any other action: become a guest and handle the event normally
    await ensureUser(s, emit);
    if (s.stage === "await_email") s.stage = "menu";
  }

  switch (ev.type) {
    case "init": {
      emit({
        kind: "text",
        text: "👋 Hi! I'm the PartSelect assistant. I can diagnose refrigerator and dishwasher problems, find the right parts, check compatibility, guide installation, and take your order.",
      });
      emit({
        kind: "text",
        text: "Enter your email to load your appliances and order history, continue as a guest — or just ask your question right away:",
      });
      emit({ kind: "email_form" });
      s.stage = "await_email";
      break;
    }

    case "submit_email": {
      await identifyUser(s, emit, ev.email);
      break;
    }

    case "continue_guest": {
      await ensureUser(s, emit);
      await emitHome(s, emit);
      break;
    }

    case "submit_image": {
      await handleImage(s, emit, ev.base64, ev.format);
      break;
    }

    case "select_appliance": {
      const m = await getModelByNo(ev.modelNo);
      if (m) {
        s.modelNo = m.model_no;
        s.applianceType = m.appliance_type;
        // Remember the confirmed machine so it shows as a card on the next visit
        // (upgraded to "owned" automatically when they purchase a part for it)
        await upsertAppliance(s.userId, m.model_no, "searched");
        emit({
          kind: "text",
          text: `✓ Selected: ${m.brand} ${m.model_no}${m.name ? ` (${m.name})` : ""}. How can I help?`,
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
            text: "What's your appliance's model number? (on the nameplate — e.g. WDT780SAEM1)",
          });
        } else {
          proceedAfterModel(s, emit);
        }
      } else if (ev.choice === "preorder") {
        emit({
          kind: "yesno",
          id: "know_partno",
          prompt: "Do you know the PartSelect part number? (it looks like PS11752778)",
        });
      } else {
        // install
        s.stage = "install_pick";
        const purchased = await getPurchasedParts(s.userId);
        if (purchased.length > 0) {
          emit({
            kind: "text",
            text: "Enter the part number, or pick one of the parts you've bought before:",
          });
          emit({
            kind: "purchased_part_chips",
            parts: purchased.map((p) => ({ partNo: p.part_no, name: p.name })),
          });
        } else {
          emit({
            kind: "text",
            text: "Enter the part number (e.g. PS11752778) and I'll pull up the installation guide:",
          });
        }
      }
      break;
    }

    case "know_partno": {
      s.intent = "preorder";
      if (ev.value) {
        s.stage = "await_partno";
        emit({ kind: "text", text: "Please enter the part number (e.g. PS11752778):" });
      } else if (!s.modelNo) {
        s.stage = "await_model";
        emit({
          kind: "text",
          text: "No problem. First, what's your appliance's model number? (on the nameplate) Then describe the part and I'll find it:",
        });
      } else {
        proceedAfterModel(s, emit);
      }
      break;
    }

    case "select_model": {
      await modelLookupFlow(s, emit, ev.modelNo);
      break;
    }

    case "select_part": {
      if (s.intent === "install" || s.stage === "install_pick" || s.stage === "install_qa") {
        await showInstallGuide(s, emit, ev.partNo);
      } else {
        await lookupPartFlow(s, emit, ev.partNo);
      }
      break;
    }

    case "none_of_these": {
      emit({ kind: "text", text: APOLOGY });
      backToMenu(s, emit);
      break;
    }

    case "add_to_cart": {
      const r = await addToCart(s.userId, ev.partNo, ev.qty ?? 1);
      if (r.ok) {
        emit({ kind: "text", text: "✅ Added to cart." });
        emit({ kind: "cart", cart: await cartView(s.userId) });
      } else if (r.reason === "out_of_stock") {
        emit({
          kind: "text",
          text: "This part is currently out of stock and can't be ordered right now.",
        });
      } else if (r.reason === "insufficient_stock") {
        emit({ kind: "text", text: "Not enough stock to add more of this item." });
      } else {
        emit({ kind: "text", text: APOLOGY });
      }
      break;
    }

    case "remove_from_cart": {
      await removeFromCart(s.userId, ev.partNo);
      emit({ kind: "cart", cart: await cartView(s.userId) });
      break;
    }

    case "checkout": {
      await startCheckout(s, emit);
      break;
    }

    case "confirm_order": {
      if (s.stage !== "awaiting_confirm") break;
      if (ev.value) {
        s.stage = "await_address";
        emit({ kind: "text", text: "Please enter your shipping address:" });
        emit({ kind: "address_form", saved: (await getSavedAddress(s.userId)) as never });
      } else {
        emit({
          kind: "text",
          text: "No problem — the order wasn't placed. Feel free to keep shopping or adjust your cart.",
        });
        backToMenu(s, emit);
      }
      break;
    }

    case "submit_address": {
      if (s.stage !== "await_address") break;
      s.pendingAddress = ev.address;
      s.stage = "await_payment";
      const cart = await cartView(s.userId);
      emit({
        kind: "text",
        text: "Address saved. Last step — enter your card number (demo environment: any Visa number that passes validation works, e.g. 4242 4242 4242 4242):",
      });
      emit({ kind: "payment_form", total: cart.total });
      break;
    }

    case "submit_payment": {
      if (s.stage !== "await_payment" || !s.pendingAddress) break;
      const cart = await cartView(s.userId);
      const pay = charge(ev.cardNo, cart.total);
      if (!pay.ok) {
        emit({
          kind: "text",
          text: `❌ Payment failed: ${pay.reason}. Please re-enter your card number:`,
        });
        emit({ kind: "payment_form", total: cart.total });
        break;
      }
      const order = await createOrder(s.userId, s.pendingAddress, pay.last4, s.modelNo);
      if (!order.ok) {
        const msg =
          order.reason === "insufficient_stock"
            ? `Sorry — these parts just sold out: ${(order.outOfStock ?? []).join(", ")}. Your order was not placed; please adjust your cart.`
            : "We couldn't place your order. Please try again.";
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
        text: `🎉 Order #${order.orderId} confirmed — $${order.total.toFixed(2)} charged to Visa ending ${pay.last4}. Your parts will ship soon. Come back anytime to check order status or get installation help.`,
      });
      s.pendingAddress = undefined;
      backToMenu(s, emit);
      break;
    }

    case "order_part": {
      if (ev.value) {
        const part = await getPartByNo(ev.partNo);
        if (part) await emitPartCards(s, emit, [part]);
      } else {
        emit({
          kind: "text",
          text: "Alright — good luck with the installation! Come back anytime if you need help.",
        });
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
        case "await_email": {
          await identifyUser(s, emit, text);
          break;
        }
        case "await_model": {
          if (isOutOfScope(text)) { deflectOutOfScope(s, emit); break; }
          // The user was asked for a model but people often type something else.
          // A part number → handle the part. A model number → look it up.
          // Anything else is a description → continue by intent instead of dead-ending.
          const partMatch = text.match(PART_NO_RE);
          if (partMatch) {
            await lookupPartFlow(s, emit, partMatch[0].toUpperCase());
            break;
          }
          const m = text.match(MODEL_NO_RE);
          if (m) {
            await modelLookupFlow(s, emit, m[0].toUpperCase());
            break;
          }
          const apType = detectApplianceType(text);
          if (apType) s.applianceType = apType;
          if (s.intent === "broken") {
            await handleFaultDesc(s, emit, text);
          } else if (s.intent === "preorder") {
            await handlePartDesc(s, emit, text);
          } else {
            // genuinely looks like a (mis-typed) model → similar options / apology
            await modelLookupFlow(s, emit, text.toUpperCase());
          }
          break;
        }
        case "await_fault_desc": {
          if (isOutOfScope(text)) { deflectOutOfScope(s, emit); break; }
          await handleFaultDesc(s, emit, text);
          break;
        }
        case "await_partno": {
          const m = text.match(PART_NO_RE);
          await lookupPartFlow(s, emit, (m?.[0] ?? text).toUpperCase());
          break;
        }
        case "await_part_desc": {
          if (isOutOfScope(text)) { deflectOutOfScope(s, emit); break; }
          await handlePartDesc(s, emit, text);
          break;
        }
        case "install_pick": {
          const m = text.match(PART_NO_RE);
          if (m) {
            await showInstallGuide(s, emit, m[0].toUpperCase());
          } else {
            await agentAnswer(s, text, emit);
          }
          break;
        }
        case "install_qa": {
          // Deterministic shortcuts (part numbers, compatibility) take priority;
          // pure installation questions fall through to the agent
          await routeFreeText(s, emit, text);
          break;
        }
        case "await_address":
        case "await_payment":
        case "awaiting_confirm": {
          emit({
            kind: "text",
            text: "Please finish the current step above first — or cancel it to go back to the menu.",
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
