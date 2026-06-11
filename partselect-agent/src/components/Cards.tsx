"use client";

import { useState } from "react";
import type {
  ApplianceCard, PartCard, CartView, InstallGuideView, Address,
} from "@/shared/protocol";

const typeIcon = (t: string) => (t === "refrigerator" ? "🧊" : "🍽️");
const typeName = (t: string) => (t === "refrigerator" ? "冰箱" : "洗碗机");

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
          <span className="src">{a.source === "purchased" ? "✓ 已购家电" : "查询过"}</span>
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
      <button className="chip" onClick={() => props.onChoice("broken")}>🔧 家电损坏了</button>
      <button className="chip" onClick={() => props.onChoice("preorder")}>🛒 预购替换零件</button>
      <button className="chip" onClick={() => props.onChoice("install")}>📦 如何安装我的部件</button>
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
              {p.mfrPartNo && <> · 厂家号 {p.mfrPartNo}</>}
              {p.brand && <> · {p.brand}{typeName(p.applianceType)}</>}
            </div>
            <div className="badges">
              {p.outOfStock && <span className="badge2 out">该零件已无库存</span>}
              {p.lowStock && <span className="badge2 low">仅剩 {p.stockQty} 件</span>}
              {!p.outOfStock && !p.lowStock && <span className="badge2 stock">现货</span>}
              {p.compatibleWithSessionModel === true && <span className="badge2 fit">✓ 适配您的型号</span>}
              {p.compatibleWithSessionModel === false && <span className="badge2 nofit">✗ 不适配您的型号</span>}
            </div>
          </div>
          <div className="pside">
            <div className="price">${p.price.toFixed(2)}</div>
            <button
              className="addBtn"
              disabled={p.outOfStock}
              onClick={() => props.onAdd(p.partNo)}
            >
              {p.outOfStock ? "缺货" : "确认加入购物车"}
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
        >{props.noneLabel ?? "都不是"}</button>
      )}
    </div>
  );
}

const DIFFICULTY: Record<string, string> = {
  easy: "★☆☆ 简单", medium: "★★☆ 中等", hard: "★★★ 较难",
};

export function InstallCard(props: { guide: InstallGuideView }) {
  const g = props.guide;
  return (
    <div className="installCard">
      <h4>🛠️ 安装指南:{g.partName}({g.partNo})</h4>
      <div className="metaRow">
        {g.difficulty && <span>难度 {DIFFICULTY[g.difficulty] ?? g.difficulty}</span>}
        {g.estTimeMinutes != null && <span>⏱ 约 {g.estTimeMinutes} 分钟</span>}
        {g.tools && <span>🔩 工具:{g.tools}</span>}
      </div>
      <ol>
        {g.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div className="linkRow">
        {g.videoUrl && <a href={g.videoUrl} target="_blank" rel="noreferrer">▶ 安装视频</a>}
        {g.manualUrl && <a href={g.manualUrl} target="_blank" rel="noreferrer">📄 图文说明书</a>}
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
    return <div className="cartBox"><h4>🛒 购物车是空的</h4></div>;
  }
  return (
    <div className="cartBox">
      <h4>{props.title ?? "🛒 购物车"}</h4>
      {cart.items.map((i) => (
        <div className="cartLine" key={i.partNo}>
          <span>{i.name} × {i.qty}</span>
          <span>
            ${i.lineTotal.toFixed(2)}
            {props.onRemove && (
              <button className="rm" onClick={() => props.onRemove!(i.partNo)}>移除</button>
            )}
          </span>
        </div>
      ))}
      <div className="cartTotal"><span>合计</span><span>${cart.total.toFixed(2)}</span></div>
      {props.onCheckout && (
        <button className="checkoutBtn" onClick={props.onCheckout}>去结算</button>
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
        <label>收件人</label>
        <input value={a.name} onChange={set("name")} placeholder="姓名" disabled={done} />
      </div>
      <div>
        <label>街道地址</label>
        <input value={a.line1} onChange={set("line1")} placeholder="如 123 Main St, Apt 4" disabled={done} />
      </div>
      <div className="formRow2">
        <div>
          <label>城市</label>
          <input value={a.city} onChange={set("city")} disabled={done} />
        </div>
        <div>
          <label>州</label>
          <input value={a.state} onChange={set("state")} placeholder="OH" disabled={done} />
        </div>
        <div>
          <label>邮编</label>
          <input value={a.zip} onChange={set("zip")} placeholder="43004" disabled={done} />
        </div>
      </div>
      <button
        className="checkoutBtn" disabled={!ok || done}
        onClick={() => { setDone(true); props.onSubmit(a); }}
      >
        {done ? "已提交" : "确认地址"}
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
        ⚠️ 演示环境:不会产生真实扣款。输入任意能通过校验的 Visa 卡号即可,例如 4242 4242 4242 4242。
      </div>
      <div>
        <label>Visa 卡号(应付 ${props.total.toFixed(2)})</label>
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
        {done ? "处理中…" : `支付 $${props.total.toFixed(2)}`}
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
      <h3>订单已确认</h3>
      <p>订单号 #{props.orderId} · 合计 ${props.total.toFixed(2)}</p>
      <p>Visa 尾号 {props.last4} · 凭证 {props.receiptId}</p>
    </div>
  );
}
