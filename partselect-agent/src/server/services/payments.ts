/**
 * 演示用假支付模块 —— 不接任何真实支付网关,不产生真实扣款。
 * 规则:Visa 卡号(4 开头、16 位数字、通过 Luhn 校验)即支付成功。
 * 生产环境将本模块替换为 Stripe/Adyen 等网关适配器,接口不变。
 */

export type CardValidation =
  | { valid: true; last4: string }
  | { valid: false; reason: string };

export function validateVisa(cardNoRaw: string): CardValidation {
  const cardNo = cardNoRaw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(cardNo)) return { valid: false, reason: "卡号只能包含数字" };
  if (!cardNo.startsWith("4")) return { valid: false, reason: "仅支持 Visa 卡(4 开头)" };
  if (cardNo.length !== 16) return { valid: false, reason: "Visa 卡号应为 16 位数字" };
  if (!luhn(cardNo)) return { valid: false, reason: "卡号校验位不正确,请检查输入" };
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
  if (amount <= 0) return { ok: false, reason: "金额无效" };
  return {
    ok: true,
    receiptId: `DEMO-${Date.now().toString(36).toUpperCase()}`,
    last4: v.last4,
    amount,
  };
}
