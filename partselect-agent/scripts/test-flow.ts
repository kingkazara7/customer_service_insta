/** End-to-end state machine test: exercises every key path of the flow without HTTP or an LLM */
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
  // Both plain text and streamed agent text count (degraded and LLM modes must both pass)
  return evs
    .filter((e) => e.kind === "text" || e.kind === "agent_delta")
    .map((e) => (e as { text: string }).text)
    .join("\n");
}

async function identify(sessionId: string, email = "demo@example.com") {
  return turn(sessionId, { type: "submit_email", email });
}

async function main() {
  // ── Scenario 0: email / guest identity ──
  console.log("Scenario 0: email and guest identity");
  const s0 = getSession().id;
  let evs = await turn(s0, { type: "init" });
  expect("init asks for email (with guest option)", kinds(evs).includes("email_form"));
  evs = await turn(s0, { type: "submit_email", email: "not-an-email" });
  expect("invalid email is rejected", texts(evs).includes("valid email"));
  evs = await turn(s0, { type: "submit_email", email: "newcustomer@test.com" });
  expect("new email creates a fresh account", texts(evs).includes("Account created"));
  expect("fresh account has no appliance cards", !kinds(evs).includes("appliance_cards"));

  // Guest path: just start talking — nothing is blocked
  const sg = getSession().id;
  await turn(sg, { type: "init" });
  evs = await turn(sg, { type: "text", text: "PS11752778" });
  expect(
    "unidentified user is auto-promoted to guest and gets an answer",
    texts(evs).includes("guest") && kinds(evs).includes("part_cards"),
    kinds(evs)
  );
  evs = await turn(sg, { type: "continue_guest" });
  expect("explicit guest button also works", kinds(evs).includes("menu"));

  // Returning customer with appliances on file
  const s0b = getSession().id;
  await turn(s0b, { type: "init" });
  evs = await identify(s0b);
  expect("returning email is welcomed back", texts(evs).includes("Welcome back"));
  expect("returning email loads appliance cards", kinds(evs).includes("appliance_cards"));

  // Parts-only buyer → appliance inference from purchased parts
  const sm = getSession().id;
  await turn(sm, { type: "init" });
  evs = await identify(sm, "mike@example.com");
  const inferredCards = evs.find((e) => e.kind === "appliance_cards") as Extract<ServerEvent, { kind: "appliance_cards" }> | undefined;
  expect(
    "parts-only buyer gets inferred appliance suggestions",
    texts(evs).includes("likely") && !!inferredCards && inferredCards.appliances.every((a) => a.source === "inferred"),
    texts(evs).slice(0, 200)
  );
  expect(
    "inferred models are dishwashers matching his parts",
    !!inferredCards && inferredCards.appliances.every((a) => a.applianceType === "dishwasher"),
    inferredCards?.appliances
  );

  // ── Scenario 1: full purchase flow (broken-appliance branch) ──
  console.log("Scenario 1: broken appliance → diagnose → add to cart → checkout → pay");
  const s1 = getSession().id;
  evs = await turn(s1, { type: "init" });
  expect("init returns the email form", kinds(evs).includes("email_form"));
  evs = await identify(s1);
  expect("identification returns appliance cards", kinds(evs).includes("appliance_cards"));
  expect("identification returns the main menu", kinds(evs).includes("menu"));

  evs = await turn(s1, { type: "select_appliance", modelNo: "WRS325SDHZ01" });
  expect("appliance selection returns to menu", kinds(evs).includes("menu"));

  evs = await turn(s1, { type: "menu_choice", choice: "broken" });
  expect("model known → asks for fault description", texts(evs).includes("describe the problem"));

  evs = await turn(s1, { type: "text", text: "The ice maker stopped working completely, no ice at all. The water line seems fine." });
  expect("diagnosis gives troubleshooting steps (RAG)", texts(evs).toLowerCase().includes("troubleshooting"));
  const cards1 = evs.find((e) => e.kind === "part_cards") as Extract<ServerEvent, { kind: "part_cards" }> | undefined;
  expect("diagnosis recommends part cards", !!cards1 && cards1.parts.length > 0, kinds(evs));
  expect("cards include price and stock", !!cards1 && cards1.parts.every((p) => p.price > 0 && p.stockQty !== undefined));
  expect("cards are tagged with session-model compatibility", !!cards1 && cards1.parts.every((p) => p.compatibleWithSessionModel !== null));

  evs = await turn(s1, { type: "add_to_cart", partNo: "PS11749909" });
  expect("add to cart succeeds", kinds(evs).includes("cart"));

  evs = await turn(s1, { type: "checkout" });
  expect("checkout shows the order summary", kinds(evs).includes("order_summary"));
  expect("summary asks for confirmation", kinds(evs).includes("yesno"));

  evs = await turn(s1, { type: "confirm_order", value: true });
  expect("confirmation leads to the address form", kinds(evs).includes("address_form"));

  evs = await turn(s1, {
    type: "submit_address",
    address: { name: "King", line1: "1 Demo Rd", city: "Columbus", state: "OH", zip: "43004" },
  });
  expect("address leads to the payment form", kinds(evs).includes("payment_form"));

  evs = await turn(s1, { type: "submit_payment", cardNo: "5555 5555 5555 4444" });
  expect("Mastercard is rejected", texts(evs).includes("Visa"));

  evs = await turn(s1, { type: "submit_payment", cardNo: "4242 4242 4242 4242" });
  const confirmed = evs.find((e) => e.kind === "order_confirmed") as Extract<ServerEvent, { kind: "order_confirmed" }> | undefined;
  expect("test Visa succeeds and creates an order", !!confirmed && confirmed.orderId > 0, texts(evs));

  // ── Scenario 2: M module (model not found → similar options → pick) ──
  console.log("Scenario 2: similar-model matching");
  const s2 = getSession().id;
  await turn(s2, { type: "init" });
  await identify(s2);
  await turn(s2, { type: "menu_choice", choice: "broken" });
  evs = await turn(s2, { type: "text", text: "My model is WDT780SAEM9" });
  expect("model not found → notice + similar options", texts(evs).includes("couldn't find model") && kinds(evs).includes("model_chips"));
  evs = await turn(s2, { type: "select_model", modelNo: "WDT780SAEM1" });
  expect("picking a similar model continues the flow", texts(evs).includes("Model confirmed"));

  // ── Scenario 3: none of these → apology, back to menu ──
  evs = await turn(s2, { type: "none_of_these" });
  expect("apology wording is correct", texts(evs).includes("Sorry, we couldn't find the part you're looking for."));
  expect("returns to the main menu", kinds(evs).includes("menu"));

  // ── Scenario 4: pre-order branch (known part number / out of stock) ──
  console.log("Scenario 4: pre-order + stock handling");
  const s4 = getSession().id;
  await turn(s4, { type: "init" });
  await identify(s4);
  await turn(s4, { type: "menu_choice", choice: "preorder" });
  await turn(s4, { type: "know_partno", value: true });
  evs = await turn(s4, { type: "text", text: "PS11754026" });
  expect("zero-stock part shows out-of-stock notice", texts(evs).includes("out of stock"));
  evs = await turn(s4, { type: "add_to_cart", partNo: "PS11754026" });
  expect("out-of-stock part can't be added to cart", texts(evs).includes("out of stock"));
  evs = await turn(s4, { type: "text", text: "PS99999999" });
  expect("unknown part number → similar parts or apology", texts(evs).includes("couldn't find part") || texts(evs).includes("Sorry"));

  // ── Scenario 5: installation branch (case-study example #1) ──
  console.log("Scenario 5: installation guidance");
  const s5 = getSession().id;
  await turn(s5, { type: "init" });
  await identify(s5);
  evs = await turn(s5, { type: "text", text: "How can I install part number PS11752778?" });
  const install = evs.find((e) => e.kind === "install_card") as Extract<ServerEvent, { kind: "install_card" }> | undefined;
  expect("free text goes straight to the install card", !!install && install.guide.steps.length > 0, kinds(evs));
  expect("asks whether to order the part too", kinds(evs).includes("yesno"));

  // ── Scenario 6: compatibility (case-study example #2, pronoun resolution) ──
  console.log("Scenario 6: compatibility checks");
  evs = await turn(s5, { type: "text", text: "Is this part compatible with my WDT780SAEM1 model?" });
  expect("pronoun → last shown part, compatibility = no", texts(evs).includes("Not compatible"), texts(evs));
  evs = await turn(s5, { type: "text", text: "Is PS11752778 compatible with WRS325SDHZ01?" });
  expect("direct compatibility query = yes", texts(evs).includes("Compatible!"), texts(evs));

  // ── Scenario 7: scope guardrail ──
  console.log("Scenario 7: out-of-scope refusal");
  evs = await turn(s5, { type: "text", text: "Write me a poem about spring" });
  expect("politely refuses out-of-scope requests", texts(evs).includes("only help with refrigerator and dishwasher"), texts(evs));
  // Out-of-scope appliance must not be routed into the buy/repair flow (deterministic guard)
  evs = await turn(s5, { type: "text", text: "i want to buy a part for my air conditioner" });
  expect("refuses out-of-scope appliance before buy shortcut", texts(evs).includes("only help with refrigerator and dishwasher"), texts(evs));
  expect("does not ask for the part number for an AC", !texts(evs).includes("part number"), texts(evs));
  evs = await turn(s5, { type: "text", text: "my dryer is not working" });
  expect("refuses out-of-scope appliance before repair shortcut", texts(evs).includes("only help with refrigerator and dishwasher"), texts(evs));
  // In-scope still works: a fridge/dishwasher buy intent is NOT deflected
  evs = await turn(s5, { type: "text", text: "I want to buy a door bin for my fridge" });
  expect(
    "in-scope buy intent still proceeds",
    !texts(evs).includes("only help with refrigerator and dishwasher") &&
      (kinds(evs).includes("yesno") || kinds(evs).includes("part_cards")),
    kinds(evs)
  );

  // ── Scenario 8: example #3 (free-text repair intent, no model context) ──
  console.log("Scenario 8: repair intent detection");
  const s8 = getSession().id;
  await turn(s8, { type: "init" });
  await identify(s8);
  evs = await turn(s8, { type: "text", text: "The ice maker on my Whirlpool fridge is not working. How can I fix it?" });
  expect("detects repair intent and asks for the model", texts(evs).includes("model number"), texts(evs));

  // ── Scenario 9: self-cleaning guidance (case: clogged dishwasher) ──
  console.log("Scenario 9: self-cleaning guidance");
  const s9 = getSession().id;
  await turn(s9, { type: "init" });
  await identify(s9);
  await turn(s9, { type: "select_appliance", modelNo: "WDT780SAEM1" });
  evs = await turn(s9, {
    type: "text",
    text: "My dishwasher is clogged and smells bad. How do I clean it myself?",
  });
  expect(
    "returns self-cleaning instructions (filter rinse / cleaner cycle)",
    texts(evs).toLowerCase().includes("filter"),
    texts(evs).slice(0, 300)
  );
  expect("offers cleaning supplies as purchasable parts", kinds(evs).includes("part_cards"));

  // ── Scenario 10: vision (degraded path without Bedrock) ──
  console.log("Scenario 10: photo upload (vision)");
  const s10 = getSession().id;
  await turn(s10, { type: "init" });
  await identify(s10);
  // 1x1 transparent PNG; with no Bedrock locally the agent degrades gracefully
  const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  evs = await turn(s10, { type: "submit_image", base64: tinyPng, format: "png" });
  expect("acknowledges the photo", texts(evs).includes("photo"));
  expect(
    "degrades gracefully when vision unavailable (asks to type model)",
    texts(evs).toLowerCase().includes("model number") || texts(evs).toLowerCase().includes("describe"),
    texts(evs).slice(0, 200)
  );

  console.log(failures === 0 ? "\nAll checks passed ✅" : `\n${failures} check(s) failed ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
