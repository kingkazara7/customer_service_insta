import { getDb } from "../db/connection";
import { upsertAppliance } from "./users";

export type CartItem = {
  part_id: number;
  part_no: string;
  name: string;
  price: number;
  qty: number;
  stock_qty: number;
  line_total: number;
};

export type Cart = { items: CartItem[]; total: number; count: number };

export function getCart(userId: number): Cart {
  const items = getDb()
    .prepare(
      `SELECT c.part_id, p.part_no, p.name, p.price, c.qty, p.stock_qty,
              ROUND(p.price * c.qty, 2) AS line_total
       FROM carts c JOIN parts p ON p.id = c.part_id
       WHERE c.user_id = ?`
    )
    .all(userId) as CartItem[];
  const total = Math.round(items.reduce((s, i) => s + i.line_total, 0) * 100) / 100;
  return { items, total, count: items.reduce((s, i) => s + i.qty, 0) };
}

export function addToCart(
  userId: number,
  partNo: string,
  qty = 1
): { ok: boolean; reason?: string; cart: Cart } {
  const db = getDb();
  const part = db
    .prepare("SELECT id, stock_qty FROM parts WHERE part_no = ? COLLATE NOCASE")
    .get(partNo.trim()) as { id: number; stock_qty: number } | undefined;
  if (!part) return { ok: false, reason: "part_not_found", cart: getCart(userId) };
  if (part.stock_qty <= 0)
    return { ok: false, reason: "out_of_stock", cart: getCart(userId) };

  const existing = db
    .prepare("SELECT qty FROM carts WHERE user_id = ? AND part_id = ?")
    .get(userId, part.id) as { qty: number } | undefined;
  const newQty = (existing?.qty ?? 0) + qty;
  if (newQty > part.stock_qty)
    return { ok: false, reason: "insufficient_stock", cart: getCart(userId) };

  db.prepare(
    `INSERT INTO carts (user_id, part_id, qty) VALUES (?,?,?)
     ON CONFLICT(user_id, part_id) DO UPDATE SET qty = excluded.qty`
  ).run(userId, part.id, newQty);
  return { ok: true, cart: getCart(userId) };
}

export function removeFromCart(userId: number, partNo: string): Cart {
  getDb()
    .prepare(
      `DELETE FROM carts WHERE user_id = ?
       AND part_id = (SELECT id FROM parts WHERE part_no = ? COLLATE NOCASE)`
    )
    .run(userId, partNo.trim());
  return getCart(userId);
}

export function clearCart(userId: number): void {
  getDb().prepare("DELETE FROM carts WHERE user_id = ?").run(userId);
}

export type OrderResult =
  | { ok: true; orderId: number; total: number }
  | { ok: false; reason: string; outOfStock?: string[] };

/**
 * 下单事务:校验库存 → 扣减库存 → 写订单 → 清空购物车 → 家电档案标记已购。
 * 库存扣减与校验同一事务,防超卖。
 */
export function createOrder(
  userId: number,
  address: Record<string, string>,
  cardLast4: string,
  sessionModelNo?: string
): OrderResult {
  const db = getDb();
  const run = db.transaction((): OrderResult => {
    const cart = getCart(userId);
    if (cart.items.length === 0) return { ok: false, reason: "empty_cart" };

    const short: string[] = [];
    for (const item of cart.items) {
      const row = db
        .prepare("SELECT stock_qty FROM parts WHERE id = ?")
        .get(item.part_id) as { stock_qty: number };
      if (row.stock_qty < item.qty) short.push(item.part_no);
    }
    if (short.length > 0)
      return { ok: false, reason: "insufficient_stock", outOfStock: short };

    for (const item of cart.items) {
      db.prepare("UPDATE parts SET stock_qty = stock_qty - ? WHERE id = ?")
        .run(item.qty, item.part_id);
    }

    const orderId = Number(
      db.prepare(
        "INSERT INTO orders (user_id, total, address_json, card_last4) VALUES (?,?,?,?)"
      ).run(userId, cart.total, JSON.stringify(address), cardLast4).lastInsertRowid
    );
    const insItem = db.prepare(
      "INSERT INTO order_items (order_id, part_id, qty, unit_price) VALUES (?,?,?,?)"
    );
    for (const item of cart.items)
      insItem.run(orderId, item.part_id, item.qty, item.price);

    db.prepare("DELETE FROM carts WHERE user_id = ?").run(userId);
    db.prepare("UPDATE users SET address_json = ? WHERE id = ?")
      .run(JSON.stringify(address), userId);

    return { ok: true, orderId, total: cart.total };
  });

  const result = run();
  // 会话中确认过的型号在购买后升级为"已购家电"(反哺卡片视图)
  if (result.ok && sessionModelNo) upsertAppliance(userId, sessionModelNo, "purchased");
  return result;
}

export function getOrderStatus(userId: number, orderId: number) {
  const db = getDb();
  const order = db
    .prepare(
      "SELECT id, total, status, created_at, card_last4 FROM orders WHERE id = ? AND user_id = ?"
    )
    .get(orderId, userId) as
    | { id: number; total: number; status: string; created_at: string; card_last4: string }
    | undefined;
  if (!order) return null;
  const items = db
    .prepare(
      `SELECT p.part_no, p.name, oi.qty, oi.unit_price
       FROM order_items oi JOIN parts p ON p.id = oi.part_id
       WHERE oi.order_id = ?`
    )
    .all(orderId);
  return { ...order, items };
}

export function getRecentOrders(userId: number, limit = 5) {
  return getDb()
    .prepare(
      "SELECT id, total, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(userId, limit);
}
