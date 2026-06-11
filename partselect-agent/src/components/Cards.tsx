"use client";

import { useState } from "react";
import type {
  ApplianceCard, PartCard, CartView, InstallGuideView, Address,
} from "@/shared/protocol";

const typeIcon = (t: string) => (t === "refrigerator" ? "🧊" : "🍽️");
const typeName = (t: string) => (t === "refrigerator" ? "refrigerator" : "dishwasher");

export function ApplianceCards(props: {
  appliances: ApplianceCard[];
  onSelect: (modelNo: string) => void;
}) {
  return (
    <div className="applianceGrid">
      {props.appliances.map((a) => (
        <div
          key={a.modelNo}
          className="applianceCard"
          onClick={() => props.onSelect(a.modelNo)}
        >
          <div className="icon">{typeIcon(a.applianceType)}</div>
          <div className="model">{a.brand} {a.modelNo}</div>
          {a.name && <div className="name">{a.name}</div>}
          <span className="src">{a.source === "purchased" ? "✓ Owned" : "Searched"}</span>
        </div>
      ))}
    </div>
  );
}

export function MenuButtons(props: {
  onChoice: (c: "broken" | "preorder" | "install") => void;
}) {
  return (
    <div className="btnRow">
      <button className="chip" onClick={() => props.onChoice("broken")}>🔧 My appliance is broken</button>
      <button className="chip" onClick={() => props.onChoice("preorder")}>🛒 Order a replacement part</button>
      <button className="chip" onClick={() => props.onChoice("install")}>📦 How to install my part</button>
    </div>
  );
}

export function YesNoButtons(props: {
  prompt: string;
  yesLabel: string;
  noLabel: string;
  onAnswer: (v: boolean) => void;
}) {
  const [answered, setAnswered] = useState(false);
  return (
    <div>
      <div className="bubble bot" style={{ marginBottom: 8 }}>{props.prompt}</div>
      <div className="btnRow">
        <button
          className="chip gold" disabled={answered}
          onClick={() => { setAnswered(true); props.onAnswer(true); }}
        >{props.yesLabel}</button>
        <button
          className="chip ghost" disabled={answered}
          onClick={() => { setAnswered(true); props.onAnswer(false); }}
        >{props.noLabel}</button>
      </div>
    </div>
  );
}

export function PartCards(props: {
  parts: PartCard[];
  onAdd: (partNo: string) => void;
}) {
  return (
    <div className="partGrid">
      {props.parts.map((p) => (
        <div key={p.partNo} className={`partCard${p.outOfStock ? " oos" : ""}`}>
          <div className="picon">{typeIcon(p.applianceType)}</div>
          <div className="pbody">
            <div className="pname">{p.name}</div>
            <div className="pno">
              {p.productUrl
                ? <a href={p.productUrl} target="_blank" rel="noreferrer">{p.partNo}</a>
                : p.partNo}
              {p.mfrPartNo && <> · Mfr # {p.mfrPartNo}</>}
              {p.brand && <> · {p.brand} {typeName(p.applianceType)}</>}
            </div>
            <div className="badges">
              {p.outOfStock && <span className="badge2 out">Out of stock</span>}
              {p.lowStock && <span className="badge2 low">Only {p.stockQty} left</span>}
              {!p.outOfStock && !p.lowStock && <span className="badge2 stock">In stock</span>}
              {p.compatibleWithSessionModel === true && <span className="badge2 fit">✓ Fits your model</span>}
              {p.compatibleWithSessionModel === false && <span className="badge2 nofit">✗ Doesn&apos;t fit your model</span>}
            </div>
          </div>
          <div className="pside">
            <div className="price">${p.price.toFixed(2)}</div>
            <button
              className="addBtn"
              disabled={p.outOfStock}
              onClick={() => props.onAdd(p.partNo)}
            >
              {p.outOfStock ? "Out of stock" : "Add to Cart"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Chips(props: {
  items: { id: string; label: string }[];
  noneLabel?: string;
  onPick: (id: string) => void;
  onNone?: () => void;
}) {
  const [picked, setPicked] = useState(false);
  return (
    <div className="btnRow">
      {props.items.map((it) => (
        <button
          key={it.id} className="chip" disabled={picked}
          onClick={() => { setPicked(true); props.onPick(it.id); }}
        >{it.label}</button>
      ))}
      {props.onNone && (
        <button
          className="chip ghost" disabled={picked}
          onClick={() => { setPicked(true); props.onNone!(); }}
        >{props.noneLabel ?? "None of these"}</button>
      )}
    </div>
  );
}

const DIFFICULTY: Record<string, string> = {
  easy: "★☆☆ Easy", medium: "★★☆ Medium", hard: "★★★ Hard",
};

export function InstallCard(props: { guide: InstallGuideView }) {
  const g = props.guide;
  return (
    <div className="installCard">
      <h4>🛠️ Installation Guide: {g.partName} ({g.partNo})</h4>
      <div className="metaRow">
        {g.difficulty && <span>Difficulty {DIFFICULTY[g.difficulty] ?? g.difficulty}</span>}
        {g.estTimeMinutes != null && <span>⏱ About {g.estTimeMinutes} min</span>}
        {g.tools && <span>🔩 Tools: {g.tools}</span>}
      </div>
      <ol>
        {g.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div className="linkRow">
        {g.videoUrl && <a href={g.videoUrl} target="_blank" rel="noreferrer">▶ Watch video</a>}
        {g.manualUrl && <a href={g.manualUrl} target="_blank" rel="noreferrer">📄 Illustrated manual</a>}
      </div>
    </div>
  );
}

export function CartBox(props: {
  cart: CartView;
  title?: string;
  onRemove?: (partNo: string) => void;
  onCheckout?: () => void;
}) {
  const { cart } = props;
  if (cart.items.length === 0) {
    return <div className="cartBox"><h4>🛒 Your cart is empty</h4></div>;
  }
  return (
    <div className="cartBox">
      <h4>{props.title ?? "🛒 Cart"}</h4>
      {cart.items.map((i) => (
        <div className="cartLine" key={i.partNo}>
          <span>{i.name} × {i.qty}</span>
          <span>
            ${i.lineTotal.toFixed(2)}
            {props.onRemove && (
              <button className="rm" onClick={() => props.onRemove!(i.partNo)}>Remove</button>
            )}
          </span>
        </div>
      ))}
      <div className="cartTotal"><span>Total</span><span>${cart.total.toFixed(2)}</span></div>
      {props.onCheckout && (
        <button className="checkoutBtn" onClick={props.onCheckout}>Checkout</button>
      )}
    </div>
  );
}

export function AddressForm(props: {
  saved: Address | null;
  onSubmit: (a: Address) => void;
}) {
  const [a, setA] = useState<Address>(
    props.saved ?? { name: "", line1: "", city: "", state: "", zip: "" }
  );
  const [done, setDone] = useState(false);
  const ok = a.name && a.line1 && a.city && a.state && a.zip;
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setA({ ...a, [k]: e.target.value });
  return (
    <div className="formBox">
      <div>
        <label>Recipient</label>
        <input value={a.name} onChange={set("name")} placeholder="Full name" disabled={done} />
      </div>
      <div>
        <label>Street address</label>
        <input value={a.line1} onChange={set("line1")} placeholder="e.g. 123 Main St, Apt 4" disabled={done} />
      </div>
      <div className="formRow2">
        <div>
          <label>City</label>
          <input value={a.city} onChange={set("city")} disabled={done} />
        </div>
        <div>
          <label>State</label>
          <input value={a.state} onChange={set("state")} placeholder="OH" disabled={done} />
        </div>
        <div>
          <label>ZIP</label>
          <input value={a.zip} onChange={set("zip")} placeholder="43004" disabled={done} />
        </div>
      </div>
      <button
        className="checkoutBtn" disabled={!ok || done}
        onClick={() => { setDone(true); props.onSubmit(a); }}
      >
        {done ? "Submitted" : "Confirm address"}
      </button>
    </div>
  );
}

export function PaymentForm(props: {
  total: number;
  onSubmit: (cardNo: string) => void;
}) {
  const [card, setCard] = useState("");
  const [done, setDone] = useState(false);
  const digits = card.replace(/[\s-]/g, "");
  const ok = /^4\d{15}$/.test(digits);
  return (
    <div className="formBox">
      <div className="demoNote">
        ⚠️ Demo environment — no real charges. Enter any Visa number that passes validation, e.g. 4242 4242 4242 4242.
      </div>
      <div>
        <label>Visa card number (total due ${props.total.toFixed(2)})</label>
        <input
          value={card}
          onChange={(e) => setCard(e.target.value)}
          placeholder="4242 4242 4242 4242"
          inputMode="numeric"
          disabled={done}
        />
      </div>
      <button
        className="checkoutBtn" disabled={!ok || done}
        onClick={() => { setDone(true); props.onSubmit(card); }}
      >
        {done ? "Processing…" : `Pay $${props.total.toFixed(2)}`}
      </button>
    </div>
  );
}

export function OrderConfirmed(props: {
  orderId: number; total: number; last4: string; receiptId: string;
}) {
  return (
    <div className="confirmBox">
      <div className="big">🎉</div>
      <h3>Order confirmed</h3>
      <p>Order #{props.orderId} · Total ${props.total.toFixed(2)}</p>
      <p>Visa ending {props.last4} · Receipt {props.receiptId}</p>
    </div>
  );
}
