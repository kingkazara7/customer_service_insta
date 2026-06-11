/**
 * DEMO-ONLY fake payment module — no real payment gateway, no real charges.
 * Rule: a Visa number (starts with 4, 16 digits, passes the Luhn check) succeeds.
 * In production, swap this module for a Stripe/Adyen adapter; the interface stays the same.
 */

export type CardValidation =
  | { valid: true; last4: string }
  | { valid: false; reason: string };

export function validateVisa(cardNoRaw: string): CardValidation {
  const cardNo = cardNoRaw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(cardNo)) return { valid: false, reason: "Card number must contain only digits" };
  if (!cardNo.startsWith("4")) return { valid: false, reason: "Only Visa cards are supported (number starts with 4)" };
  if (cardNo.length !== 16) return { valid: false, reason: "A Visa number must be 16 digits" };
  if (!luhn(cardNo)) return { valid: false, reason: "The card number failed validation — please check for typos" };
  return { valid: true, last4: cardNo.slice(-4) };
}

function luhn(s: string): boolean {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export type ChargeResult =
  | { ok: true; receiptId: string; last4: string; amount: number }
  | { ok: false; reason: string };

export function charge(cardNoRaw: string, amount: number): ChargeResult {
  const v = validateVisa(cardNoRaw);
  if (!v.valid) return { ok: false, reason: v.reason };
  if (amount <= 0) return { ok: false, reason: "Invalid amount" };
  return {
    ok: true,
    receiptId: `DEMO-${Date.now().toString(36).toUpperCase()}`,
    last4: v.last4,
    amount,
  };
}
