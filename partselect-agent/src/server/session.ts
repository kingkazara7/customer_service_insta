import { randomUUID } from "node:crypto";
import type { Address } from "@/shared/protocol";
import { getOrCreateDemoUser } from "./services/users";

export type Stage =
  | "menu"
  | "await_model"
  | "await_fault_desc"
  | "await_partno"
  | "await_part_desc"
  | "install_pick"
  | "install_qa"
  | "awaiting_confirm"
  | "await_address"
  | "await_payment";

export type Session = {
  id: string;
  userId: number;
  stage: Stage;
  intent?: "broken" | "preorder" | "install";
  modelNo?: string;
  applianceType?: "refrigerator" | "dishwasher";
  lastPartNos: string[];
  installPartNo?: string;
  pendingAddress?: Address;
  /** Short history used only by the agent's fuzzy nodes; hard-capped to control tokens */
  history: { role: "user" | "assistant"; text: string }[];
};

// globalThis survives Next.js dev hot reloads, so sessions persist;
// swapping to Redis in production only touches this file
const store: Map<string, Session> =
  (globalThis as Record<string, unknown>).__psSessions as Map<string, Session> ??
  new Map();
(globalThis as Record<string, unknown>).__psSessions = store;

export function getSession(id?: string): Session {
  if (id) {
    const s = store.get(id);
    if (s) return s;
  }
  const session: Session = {
    id: id ?? randomUUID(),
    userId: getOrCreateDemoUser(),
    stage: "menu",
    lastPartNos: [],
    history: [],
  };
  store.set(session.id, session);
  return session;
}

export function pushHistory(s: Session, role: "user" | "assistant", text: string) {
  s.history.push({ role, text: text.slice(0, 500) });
  if (s.history.length > 8) s.history.splice(0, s.history.length - 8);
}
