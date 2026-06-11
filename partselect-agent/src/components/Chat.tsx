"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientEvent, ServerEvent, CartView } from "@/shared/protocol";
import {
  ApplianceCards, MenuButtons, YesNoButtons, PartCards, Chips,
  InstallCard, CartBox, AddressForm, PaymentForm, OrderConfirmed, EmailForm,
} from "./Cards";

type NewFeedItem =
  | { type: "user"; text: string }
  | { type: "bot"; text: string }
  | { type: "event"; ev: ServerEvent };

type FeedItem = NewFeedItem & { id: number };

let nextId = 1;

const YESNO_LABELS: Record<string, [string, string]> = {
  know_partno: ["I know the part number", "I don't know it"],
  confirm_order: ["✓ Place order", "Not yet"],
  order_part: ["Yes, order it", "No thanks"],
};

export default function Chat() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cart, setCart] = useState<CartView>({ items: [], total: 0, count: 0 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const initedRef = useRef(false);

  const append = useCallback((item: NewFeedItem) => {
    setFeed((f) => [...f, { ...item, id: nextId++ }]);
  }, []);

  const sendEvent = useCallback(
    async (ev: ClientEvent) => {
      setBusy(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current, event: ev }),
        });
        const sid = res.headers.get("x-session-id");
        if (sid) sessionIdRef.current = sid;
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let agentBubbleId: number | null = null;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const sev = JSON.parse(line.slice(6)) as ServerEvent;
            if (sev.kind === "done") continue;
            if (sev.kind === "cart") setCart(sev.cart);
            if (sev.kind === "order_confirmed") {
              setCart({ items: [], total: 0, count: 0 });
            }
            if (sev.kind === "agent_delta") {
              // merge streamed LLM text into a single bubble
              if (agentBubbleId === null) {
                agentBubbleId = nextId++;
                setFeed((f) => [
                  ...f,
                  { id: agentBubbleId!, type: "bot", text: sev.text },
                ]);
              } else {
                setFeed((f) =>
                  f.map((it) =>
                    it.id === agentBubbleId && it.type === "bot"
                      ? { ...it, text: it.text + sev.text }
                      : it
                  )
                );
              }
              continue;
            }
            agentBubbleId = null;
            if (sev.kind === "text") append({ type: "bot", text: sev.text });
            else append({ type: "event", ev: sev });
          }
        }
      } catch (err) {
        console.error(err);
        append({ type: "bot", text: "Something went wrong — please try again." });
      } finally {
        setBusy(false);
      }
    },
    [append]
  );

  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    sendEvent({ type: "init" });
  }, [sendEvent]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [feed, busy]);

  const submitText = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    append({ type: "user", text });
    void sendEvent({ type: "text", text });
  };

  const userEcho = (label: string, ev: ClientEvent) => {
    append({ type: "user", text: label });
    void sendEvent(ev);
  };

  const renderEvent = (item: Extract<FeedItem, { type: "event" }>) => {
    const ev = item.ev;
    switch (ev.kind) {
      case "email_form":
        return (
          <EmailForm
            onSubmit={(email) => userEcho(email, { type: "submit_email", email })}
          />
        );
      case "appliance_cards":
        return (
          <ApplianceCards
            appliances={ev.appliances}
            onSelect={(m) => userEcho(`My appliance: ${m}`, { type: "select_appliance", modelNo: m })}
          />
        );
      case "menu":
        return (
          <MenuButtons
            onChoice={(c) => {
              const label =
                c === "broken" ? "🔧 My appliance is broken" : c === "preorder" ? "🛒 Order a replacement part" : "📦 How to install my part";
              userEcho(label, { type: "menu_choice", choice: c });
            }}
          />
        );
      case "yesno": {
        const [yes, no] = YESNO_LABELS[ev.id] ?? ["Yes", "No"];
        return (
          <YesNoButtons
            prompt={ev.prompt}
            yesLabel={yes}
            noLabel={no}
            onAnswer={(v) => {
              const label = v ? yes : no;
              if (ev.id === "know_partno")
                userEcho(label, { type: "know_partno", value: v });
              else if (ev.id === "confirm_order")
                userEcho(label, { type: "confirm_order", value: v });
              else
                userEcho(label, { type: "order_part", partNo: ev.partNo ?? "", value: v });
            }}
          />
        );
      }
      case "part_cards":
        return (
          <PartCards
            parts={ev.parts}
            onAdd={(no) => userEcho(`Add to cart: ${no}`, { type: "add_to_cart", partNo: no })}
          />
        );
      case "model_chips":
        return (
          <Chips
            items={ev.models.map((m) => ({
              id: m.modelNo,
              label: `${m.brand} ${m.modelNo}`,
            }))}
            onPick={(id) => userEcho(id, { type: "select_model", modelNo: id })}
            onNone={() => userEcho("None of these", { type: "none_of_these" })}
          />
        );
      case "part_chips":
        return (
          <Chips
            items={ev.parts.map((p) => ({ id: p.partNo, label: `${p.partNo} ${p.name}` }))}
            onPick={(id) => userEcho(id, { type: "select_part", partNo: id })}
            onNone={() => userEcho("None of these", { type: "none_of_these" })}
          />
        );
      case "purchased_part_chips":
        return (
          <Chips
            items={ev.parts.map((p) => ({ id: p.partNo, label: `🧾 ${p.partNo} ${p.name}` }))}
            onPick={(id) => userEcho(id, { type: "select_part", partNo: id })}
          />
        );
      case "install_card":
        return <InstallCard guide={ev.guide} />;
      case "cart":
        return (
          <CartBox
            cart={ev.cart}
            onRemove={(no) => userEcho(`Remove: ${no}`, { type: "remove_from_cart", partNo: no })}
            onCheckout={() => userEcho("Checkout", { type: "checkout" })}
          />
        );
      case "order_summary":
        return <CartBox cart={ev.cart} title={`📋 Order summary${ev.modelNo ? ` (${ev.modelNo})` : ""}`} />;
      case "address_form":
        return (
          <AddressForm
            saved={ev.saved}
            onSubmit={(a) =>
              userEcho(`Ship to: ${a.line1}, ${a.city}`, { type: "submit_address", address: a })
            }
          />
        );
      case "payment_form":
        return (
          <PaymentForm
            total={ev.total}
            onSubmit={(card) =>
              userEcho(`Paying with card **** ${card.replace(/\D/g, "").slice(-4)}`, {
                type: "submit_payment",
                cardNo: card,
              })
            }
          />
        );
      case "order_confirmed":
        return (
          <OrderConfirmed
            orderId={ev.orderId}
            total={ev.total}
            last4={ev.last4}
            receiptId={ev.receiptId}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo">Part<em>Select</em></span>
          <span className="tag">Parts Assistant · Refrigerators &amp; Dishwashers</span>
        </div>
        <button className="cartBtn" onClick={() => setDrawerOpen(true)}>
          🛒 Cart
          {cart.count > 0 && <span className="badge">{cart.count}</span>}
        </button>
      </header>

      <div className="feed" ref={feedRef}>
        {feed.map((item) =>
          item.type === "user" ? (
            <div className="row user" key={item.id}>
              <div className="bubble user">{item.text}</div>
            </div>
          ) : item.type === "bot" ? (
            <div className="row" key={item.id}>
              <div className="bubble bot">{item.text}</div>
            </div>
          ) : (
            <div className="row" key={item.id}>
              <div className="widget">{renderEvent(item)}</div>
            </div>
          )
        )}
        {busy && (
          <div className="row">
            <div className="bubble bot">
              <span className="typing"><span /><span /><span /></span>
            </div>
          </div>
        )}
      </div>

      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitText()}
          placeholder="Describe the issue, or enter a part / model number… (e.g. ice maker not working / PS11752778)"
          disabled={busy}
        />
        <button onClick={submitText} disabled={busy || !input.trim()}>Send</button>
      </div>

      {drawerOpen && (
        <>
          <div className="drawerMask" onClick={() => setDrawerOpen(false)} />
          <div className="drawer">
            <h3>🛒 Cart</h3>
            <CartBox
              cart={cart}
              onRemove={(no) => {
                setDrawerOpen(false);
                userEcho(`Remove: ${no}`, { type: "remove_from_cart", partNo: no });
              }}
              onCheckout={() => {
                setDrawerOpen(false);
                userEcho("Checkout", { type: "checkout" });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
