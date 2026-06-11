import { NextRequest } from "next/server";
import { getSession } from "@/server/session";
import { handleEvent } from "@/server/stateMachine";
import type { ClientEvent, ServerEvent } from "@/shared/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 聊天端点:每个请求一轮(事件进 → SSE 事件流出)。
 * 会话 ID 通过响应头 x-session-id 下发,客户端后续请求带回。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sessionId?: string;
    event: ClientEvent;
  };
  const session = getSession(body.sessionId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (ev: ServerEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        await handleEvent(session, body.event, emit);
      } catch (err) {
        console.error("chat handler error:", err);
        emit({ kind: "text", text: "系统出了点问题,请重试。" });
        emit({ kind: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-session-id": session.id,
    },
  });
}
