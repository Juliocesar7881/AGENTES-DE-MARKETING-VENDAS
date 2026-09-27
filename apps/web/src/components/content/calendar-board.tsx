"use client";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/platform-icon";
import { cn } from "@/lib/utils";
import { scheduleAtLocalAction } from "@/server/actions/content";

export interface CalItem {
  id: string;
  number: number;
  hook: string;
  status: string;
  localDate: string | null;
  localTime: string | null;
  platforms: string[];
  draggable: boolean;
}

export interface CalDay {
  date: string;
  label: string;
  weekday: string;
  isToday: boolean;
  isPast: boolean;
}

const TONE: Record<string, string> = {
  SCHEDULED: "border-primary/40 bg-primary-soft",
  PUBLISHED: "border-success/40 bg-success-soft",
  PUBLISHING: "border-warning/40 bg-warning-soft",
  FAILED: "border-danger/40 bg-danger-soft",
  READY: "border-border bg-card",
};

function Card({ item, slug }: { item: CalItem; slug: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id, disabled: !item.draggable });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("rounded-md border px-2 py-1.5 text-[11px] shadow-card transition-shadow", TONE[item.status] ?? "border-border bg-card", item.draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default", isDragging && "z-50 shadow-pop ring-2 ring-primary")}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="tabular text-subtle">#{item.number}</span>
        <span className="flex -space-x-1">
          {item.platforms.slice(0, 3).map((p) => (
            <PlatformIcon key={p} platform={p} size={12} />
          ))}
        </span>
      </div>
      <Link href={`/w/${slug}/content/${item.id}`} className="mt-0.5 line-clamp-2 leading-snug font-medium hover:underline" onPointerDown={(e) => e.stopPropagation()}>
        {item.hook}
      </Link>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{item.status === "PUBLISHED" ? "published" : item.status.toLowerCase()}</div>
    </div>
  );
}

function Cell({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div ref={setNodeRef} className={cn("min-h-16 space-y-1.5 rounded-md border border-dashed border-transparent p-1 transition-colors", !disabled && "hover:border-border", isOver && "border-primary bg-primary-soft/60", disabled && "opacity-60")}>
      {children}
    </div>
  );
}

export function CalendarBoard({ slug, days, times, items, tray }: { slug: string; days: CalDay[]; times: string[]; items: CalItem[]; tray: CalItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, { date: string; time: string }>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const [date, time] = String(e.over.id).split("|") as [string, string];
    const id = String(e.active.id);
    setOptimistic((o) => ({ ...o, [id]: { date, time } }));
    start(async () => {
      const r = await scheduleAtLocalAction(id, date, time);
      if (r.ok) toast.success(`Scheduled for ${date.split("-").reverse().slice(0, 2).join("/")} ${time}`);
      else {
        toast.error(r.error);
        setOptimistic((o) => {
          const { [id]: _drop, ...rest } = o;
          return rest;
        });
      }
      router.refresh();
    });
  };

  const placed = [...items, ...tray.filter((t) => optimistic[t.id])].map((i) => (optimistic[i.id] ? { ...i, localDate: optimistic[i.id]!.date, localTime: optimistic[i.id]!.time, status: "SCHEDULED" } : i));
  const trayLeft = tray.filter((t) => !optimistic[t.id]);

  return (
    <DndContext id="calendar-dnd" sensors={sensors} onDragEnd={onDragEnd}>
      <div className={cn("grid gap-4 xl:grid-cols-[1fr_240px]", pending && "cursor-progress")}>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <div className="grid min-w-[880px]" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div className="border-b border-border" />
            {days.map((d) => (
              <div key={d.date} className={cn("border-b border-l border-border px-2 py-2 text-center", d.isToday && "bg-primary-soft/50")}>
                <div className="text-[11px] text-muted-foreground uppercase">{d.weekday}</div>
                <div className={cn("text-sm font-semibold", d.isToday && "text-primary")}>{d.label}</div>
              </div>
            ))}
            {times.map((t) => (
              <div key={t} className="contents">
                <div className="tabular border-b border-border px-2 py-2 text-right text-[11px] text-muted-foreground">{t}</div>
                {days.map((d) => (
                  <div key={d.date + t} className={cn("border-b border-l border-border p-1", d.isToday && "bg-primary-soft/20")}>
                    <Cell id={`${d.date}|${t}`} disabled={d.isPast}>
                      {placed
                        .filter((i) => i.localDate === d.date && i.localTime === t)
                        .map((i) => (
                          <Card key={i.id} item={i} slug={slug} />
                        ))}
                    </Cell>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-1 text-sm font-semibold">Ready to schedule</div>
          <p className="mb-3 text-xs text-muted-foreground">Drag onto a time slot. Scheduled cards can be moved too.</p>
          <div className="space-y-2">
            {trayLeft.length === 0 ? <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">Nothing waiting — the buffer is scheduled.</p> : null}
            {trayLeft.map((i) => (
              <Card key={i.id} item={i} slug={slug} />
            ))}
          </div>
        </div>
      </div>
    </DndContext>
  );
}
