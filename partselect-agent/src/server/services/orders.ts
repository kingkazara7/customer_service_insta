import { db } from "../db/connection";
import type { Db } from "../db/driver";
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

async function cartItems(conn: Db, userId: number): Promise<CartItem[]> {
  return conn.all<CartItem>(
    `SELECT c.part_id, p.part_no, p.name, p.price, c.qty, p.stock_qty,
            ROUND(p.price * c.qty, 2) AS line_total
     FROM carts c JOIN parts p ON p.id = c.part_id
     WHERE c.user_id = ?`,
    [userId]
  );
}

function summarize(items: CartItem[]): Cart {
  // pg returns NUMERIC as strings; coerce to numbers
  const norm = items.map((i) => ({
    ...i,
    price: Number(i.price),
    line_total: Number(i.line_total),
  }));
  const total = Math.round(norm.reduce((s, i) => s + i.line_total, 0) * 100) / 100;
  return { items: norm, total, count: norm.reduce((s, i) => s + i.qty, 0) };
}

export async function getCart(userId: number): Promise<Cart> {
  return summarize(await cartItems(db(), userId));
}

export async function addToCart(
  userId: number,
  partNo: string,
  qty = 1
): Promise<{ ok: boolean; reason?: string; cart: Cart }> {
  const part = await db().get<{ id: number; stock_qty: number }>(
    "SELECT id, stock_qty FROM parts WHERE LOWER(part_no) = LOWER(?)",
    [partNo.trim()]
  );
  if (!part) return { ok: false, reason: "part_not_found", cart: await getCart(userId) };
  if (part.stock_qty <= 0)
    return { ok: false, reason: "out_of_stock", cart: await getCart(userId) };

  const existing = await db().get<{ qty: number }>(
    "SELECT qty FROM carts WHERE user_id = ? AND part_id = ?",
    [userId, part.id]
  );
  const newQty = (existing?.qty ?? 0) + qty;
  if (newQty > part.stock_qty)
    return { ok: false, reason: "insufficient_stock", cart: await getCart(userId) };

  await db().exec(
    `INSERT INTO carts (user_id, part_id, qty) VALUES (?,?,?)
     ON CONFLICT (user_id, part_id) DO UPDATE SET qty = excluded.qty`,
    [userId, part.id, newQty]
  );
  return { ok: true, cart: await getCart(userId) };
}

export async function removeFromCart(userId: number, partNo: string): Promise<Cart> {
  await db().exec(
    `DELETE FROM carts WHERE user_id = ?
     AND part_id = (SELECT id FROM parts WHERE LOWER(part_no) = LOWER(?))`,
    [userId, partNo.trim()]
  );
  return getCart(userId);
}

export async function clearCart(userId: number): Promise<void> {
  await db().exec("DELETE FROM carts WHERE user_id = ?", [userId]);
}

export type OrderResult =
  | { ok: true; orderId: number; total: number }
  | { ok: false; reason: string; outOfStock?: string[] };

/**
 * Order transaction: validate stock → decrement stock → write order →
 * clear cart → save address. All queries run on the transaction connection so
 * the stock re-check and decrement are atomic (oversell-proof).
 */
export async function createOrder(
  userId: number,
  address: Record<string, string>,
  cardLast4: string,
  sessionModelNo?: string
): Promise<OrderResult> {
  const result = await db().tx<OrderResult>(async (t) => {
    const cart = summarize(await cartItems(t, userId));
    if (cart.items.length === 0) return { ok: false, reason: "empty_cart" };

    const short: string[] = [];
    for (const item of cart.items) {
      const row = await t.get<{ stock_qty: number }>(
        "SELECT stock_qty FROM parts WHERE id = ?",
        [item.part_id]
      );
      if (!row || row.stock_qty < item.qty) short.push(item.part_no);
    }
    if (short.length > 0)
      return { ok: false, reason: "insufficient_stock", outOfStock: short };

    for (const item of cart.items) {
      await t.exec("UPDATE parts SET stock_qty = stock_qty - ? WHERE id = ?", [
        item.qty, item.part_id,
      ]);
    }

    const orderRow = await t.get<{ id: number }>(
      "INSERT INTO orders (user_id, total, address_json, card_last4) VALUES (?,?,?,?) RETURNING id",
      [userId, cart.total, JSON.stringify(address), cardLast4]
    );
    const orderId = orderRow!.id;
    for (const item of cart.items) {
      await t.exec(
        "INSERT INTO order_items (order_id, part_id, qty, unit_price) VALUES (?,?,?,?)",
        [orderId, item.part_id, item.qty, item.price]
      );
    }
    await t.exec("DELETE FROM carts WHERE user_id = ?", [userId]);
    await t.exec("UPDATE users SET address_json = ? WHERE id = ?", [
      JSON.stringify(address), userId,
    ]);
    return { ok: true, orderId, total: cart.total };
  });

  // After purchase, the confirmed model becomes an "owned" appliance
  if (result.ok && sessionModelNo) await upsertAppliance(userId, sessionModelNo, "purchased");
  return result;
}

export async function getOrderStatus(userId: number, orderId: number) {
  const order = await db().get<{
    id: number; total: number; status: string; created_at: string; card_last4: string;
  }>(
    "SELECT id, total, status, created_at, card_last4 FROM orders WHERE id = ? AND user_id = ?",
    [orderId, userId]
  );
  if (!order) return null;
  const items = await db().all(
    `SELECT p.part_no, p.name, oi.qty, oi.unit_price
     FROM order_items oi JOIN parts p ON p.id = oi.part_id
     WHERE oi.order_id = ?`,
    [orderId]
  );
  return { ...order, items };
}

export async function getRecentOrders(userId: number, limit = 5) {
  return db().all(
    "SELECT id, total, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, limit]
  );
}
