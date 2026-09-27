"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Hand, Pause, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { conversationModeAction, markConversationReadAction, sendHumanMessageAction } from "@/server/actions/crm";

interface ThreadData {
  conversation: { id: string; aiMode: "AI" | "PAUSED" | "HUMAN"; channel: string; lastInboundAt: string | null };
  lead: { id: string; name: string; stage: string; score: number; doNotContact: boolean; aiPaused: boolean };
  messages: { id: string; direction: "INBOUND" | "OUTBOUND"; senderType: string; body: string; deliveryStatus: string; error: string | null; createdAt: string }[];
}

export function Thread({ conversationId, slug, timezone }: { conversationId: string; slug: string; timezone: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["thread", conversationId],
    queryFn: async () => {
      const r = await fetch(`/api/conversations/${conversationId}/messages`);
      if (!r.ok) throw new Error("load failed");
      return (await r.json()) as ThreadData;
    },
    refetchInterval: 4000,
  });
  const count = data?.messages.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);
  useEffect(() => {
    void markConversationReadAction(conversationId);
  }, [conversationId]);

  const setMode = (mode: "AI" | "PAUSED" | "HUMAN") =>
    start(async () => {
      const r = await conversationModeAction(conversationId, mode);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
      await qc.invalidateQueries({ queryKey: ["thread", conversationId] });
      router.refresh();
    });

  const send = () =>
    start(async () => {
      const r = await sendHumanMessageAction(conversationId, text);
      if (r.ok) {
        setText("");
        await qc.invalidateQueries({ queryKey: ["thread", conversationId] });
      } else toast.error(r.error);
    });

  if (isLoading || !data) return <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading conversation…</div>;
  const mode = data.conversation.aiMode;
  const windowOpen = data.conversation.lastInboundAt ? Date.now() - new Date(data.conversation.lastInboundAt).getTime() < 24 * 3600_000 : false;
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: timezone });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <PlatformIcon platform={data.conversation.channel} size={22} />
        <div className="min-w-0 flex-1">
          <Link href={`/w/${slug}/crm/${data.lead.id}`} className="block truncate text-sm font-semibold hover:underline">
            {data.lead.name || "Lead"}
          </Link>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{data.lead.stage.toLowerCase()}</span>·<span>score {data.lead.score}</span>
            {data.lead.doNotContact ? <Badge tone="danger">do not contact</Badge> : null}
            {data.conversation.channel === "WHATSAPP" ? <span>· {windowOpen ? "24h window open" : "outside 24h window (template only)"}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge tone={mode === "AI" ? "success" : mode === "HUMAN" ? "info" : "warning"}>{mode === "AI" ? "Sales Agent active" : mode === "HUMAN" ? "You are handling" : "AI paused"}</Badge>
          {mode === "AI" ? (
            <>
              <Button size="xs" loading={pending} onClick={() => setMode("PAUSED")}>
                <Pause /> Pause AI
              </Button>
              <Button size="xs" variant="primary" loading={pending} onClick={() => setMode("HUMAN")}>
                <Hand /> Take over
              </Button>
            </>
          ) : (
            <>
              {mode === "PAUSED" ? (
                <Button size="xs" loading={pending} onClick={() => setMode("HUMAN")}>
                  <Hand /> Take over
                </Button>
              ) : null}
              <Button size="xs" variant="primary" loading={pending} disabled={data.lead.doNotContact} onClick={() => setMode("AI")}>
                <Bot /> Return to AI
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {data.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "INBOUND" ? "justify-start" : "justify-end")}>
            <div className="max-w-[75%]">
              <div className={cn("rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap", m.direction === "INBOUND" ? "rounded-bl-md bg-muted" : m.senderType === "AI" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-br-md bg-info text-white")}>{m.body}</div>
              <div className={cn("mt-0.5 flex items-center gap-1 text-[10px] text-subtle", m.direction === "OUTBOUND" && "justify-end")}>
                {m.direction === "OUTBOUND" ? m.senderType === "AI" ? <Bot className="size-3" /> : <UserRound className="size-3" /> : null}
                {m.direction === "OUTBOUND" ? (m.senderType === "AI" ? "Sales Agent" : m.senderType === "HUMAN" ? "You" : "System") : "Lead"} · {fmt.format(new Date(m.createdAt))}
                {m.direction === "OUTBOUND" ? ` · ${m.deliveryStatus.toLowerCase()}` : ""}
              </div>
              {m.error ? <div className="text-right text-[10px] text-danger">{m.error}</div> : null}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="border-t border-border p-3">
        {mode === "AI" ? <p className="mb-2 text-[11px] text-muted-foreground">The Sales Agent is replying. Sending a message yourself keeps the AI on — use “Take over” to pause it.</p> : null}
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Write a reply…"
            className="min-h-10 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
          />
          <Button variant="primary" loading={pending} disabled={!text.trim()} onClick={send} aria-label="Send">
            <Send />
          </Button>
        </div>
      </div>
    </div>
  );
}
