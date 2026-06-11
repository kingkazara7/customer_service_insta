import { NextRequest } from "next/server";
import { getSession } from "@/server/session";
import { handleEvent } from "@/server/stateMachine";
import type { ClientEvent, ServerEvent } from "@/shared/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chat endpoint: one turn per request (client event in → SSE event stream out).
 * The session id is issued via the x-session-id response header and echoed
 * back by the client on subsequent requests.
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
        emit({ kind: "text", text: "Something went wrong — please try again." });
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
