import { searchParts, checkCompatibility, getInstallGuide, findSimilarModels, searchDocChunks } from "../src/server/services/catalog";
import { getOrCreateDemoUser, getAppliances, getPurchasedParts, profileSummary } from "../src/server/services/users";
import { addToCart, getCart, createOrder } from "../src/server/services/orders";
import { validateVisa } from "../src/server/services/payments";
import { getDb } from "../src/server/db/connection";

const uid = getOrCreateDemoUser();
console.log("1. 家电卡片:", getAppliances(uid).map(a => `${a.brand} ${a.model_no}(${a.source})`).join(" | "));
console.log("2. 已购零件:", getPurchasedParts(uid).map(p => p.part_no).join(", "));
console.log("3. 画像注入:", profileSummary(uid));

console.log("4. 症状搜索 '制冰机不工作' (限 WRS325SDHZ01):",
  searchParts({ query: "制冰机不工作", modelNo: "WRS325SDHZ01" }).map(p => `${p.part_no} ${p.name} $${p.price}`));

console.log("5. 兼容性 PS11752778 × WDT780SAEM1:", checkCompatibility("PS11752778", "WDT780SAEM1").compatible);
console.log("6. 相近型号 'WDT780SAEM2':", findSimilarModels("WDT780SAEM2").map(m => m.model_no));
console.log("7. 安装指南 PS11752778:", JSON.stringify(getInstallGuide("PS11752778")?.steps.length), "步");
console.log("8. RAG 检索 '不排水':", searchDocChunks({ query: "不排水", applianceType: "dishwasher" }).length, "条");

console.log("9. Visa 校验 4242424242424242:", JSON.stringify(validateVisa("4242 4242 4242 4242")));
console.log("   Visa 校验 5555...(万事达):", JSON.stringify(validateVisa("5555555555554444")));

const before = (getDb().prepare("SELECT stock_qty FROM parts WHERE part_no='PS11756710'").get() as {stock_qty:number}).stock_qty;
addToCart(uid, "PS11756710", 2);
console.log("10. 购物车:", JSON.stringify(getCart(uid)));
const order = createOrder(uid, { name: "测试", line1: "123 Demo St", city: "Columbus", state: "OH", zip: "43004" }, "4242", "WDT780SAEM1");
const after = (getDb().prepare("SELECT stock_qty FROM parts WHERE part_no='PS11756710'").get() as {stock_qty:number}).stock_qty;
console.log("11. 下单:", JSON.stringify(order), `库存 ${before}→${after}`);
console.log("12. 缺货拦截:", JSON.stringify(addToCart(uid, "PS11754026")));
