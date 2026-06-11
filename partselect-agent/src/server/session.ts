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
  /** 仅供 Agent 模糊节点使用的短历史,固定截断,控制 token */
  history: { role: "user" | "assistant"; text: string }[];
};

// Next.js dev 热重载不清空 globalThis,会话得以保留;生产换 Redis 仅需改此文件
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
