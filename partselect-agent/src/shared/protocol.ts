/** Message protocol shared by frontend and backend: client events + server SSE events */

export type Address = {
  name: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
};

export type ClientEvent =
  | { type: "init" }
  | { type: "submit_email"; email: string }
  | { type: "continue_guest" }
  | { type: "text"; text: string }
  | { type: "submit_image"; base64: string; format: "jpeg" | "png" | "gif" | "webp" }
  | { type: "select_appliance"; modelNo: string }
  | { type: "menu_choice"; choice: "broken" | "preorder" | "install" }
  | { type: "know_partno"; value: boolean }
  | { type: "select_model"; modelNo: string }
  | { type: "select_part"; partNo: string }
  | { type: "add_to_cart"; partNo: string; qty?: number }
  | { type: "remove_from_cart"; partNo: string }
  | { type: "checkout" }
  | { type: "confirm_order"; value: boolean }
  | { type: "submit_address"; address: Address }
  | { type: "submit_payment"; cardNo: string }
  | { type: "order_part"; partNo: string; value: boolean }
  | { type: "none_of_these" }
  | { type: "back_to_menu" };

export type ApplianceCard = {
  modelNo: string;
  brand: string;
  applianceType: "refrigerator" | "dishwasher";
  name: string | null;
  /** purchased = owned; searched = looked up before; inferred = guessed from purchased parts */
  source: "purchased" | "searched" | "inferred";
};

export type PartCard = {
  partNo: string;
  mfrPartNo: string | null;
  name: string;
  brand: string | null;
  applianceType: "refrigerator" | "dishwasher";
  price: number;
  stockQty: number;
  lowStock: boolean;      // 0 < stock <= 5 → "Only N left"
  outOfStock: boolean;    // "Out of stock"
  productUrl: string | null;
  compatibleWithSessionModel: boolean | null; // null = no model context in session
};

export type CartView = {
  items: { partNo: string; name: string; price: number; qty: number; lineTotal: number }[];
  total: number;
  count: number;
};

export type InstallGuideView = {
  partNo: string;
  partName: string;
  difficulty: string | null;
  estTimeMinutes: number | null;
  tools: string | null;
  steps: string[];
  videoUrl: string | null;
  manualUrl: string | null;
};

export type ServerEvent =
  | { kind: "text"; text: string }
  | { kind: "agent_delta"; text: string }
  | { kind: "email_form" }
  | { kind: "appliance_cards"; appliances: ApplianceCard[] }
  | { kind: "menu" }
  | {
      kind: "yesno";
      id: "know_partno" | "confirm_order" | "order_part";
      prompt: string;
      partNo?: string;
    }
  | { kind: "part_cards"; parts: PartCard[] }
  | { kind: "model_chips"; models: { modelNo: string; brand: string; name: string | null }[] }
  | { kind: "part_chips"; parts: { partNo: string; name: string }[] }
  | {
      kind: "purchased_part_chips";
      parts: { partNo: string; name: string }[];
    }
  | { kind: "install_card"; guide: InstallGuideView }
  | { kind: "cart"; cart: CartView }
  | { kind: "order_summary"; cart: CartView; modelNo?: string }
  | { kind: "address_form"; saved: Address | null }
  | { kind: "payment_form"; total: number }
  | {
      kind: "order_confirmed";
      orderId: number;
      total: number;
      last4: string;
      receiptId: string;
    }
  | { kind: "done" };
