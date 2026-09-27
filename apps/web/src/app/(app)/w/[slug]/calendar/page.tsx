import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { addLocalDays, localDateString, localTimeString, localWeekday, zonedToUtc } from "@revenueos/shared";
import { and, contents, eq, gte, inArray, isNull, lt, or, withUser } from "@revenueos/database";
import { CalendarBoard, type CalDay, type CalItem } from "@/components/content/calendar-board";
import { Button } from "@/components/ui/button";
import { requireWorkspace } from "@/server/session";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ week?: string }> }) {
  const { slug } = await params;
  const { week } = await searchParams;
  const { user, ws } = await requireWorkspace(slug);
  const tz = ws.timezone;
  const today = localDateString(new Date(), tz);
  let start = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today;
  const wd = localWeekday(zonedToUtc(start, "12:00", tz), tz);
  start = addLocalDays(start, -((wd + 6) % 7)); // Monday
  const dayList = Array.from({ length: 7 }, (_, i) => addLocalDays(start, i));
  const from = zonedToUtc(dayList[0]!, "00:00", tz);
  const to = zonedToUtc(addLocalDays(dayList[6]!, 1), "00:00", tz);

  const rows = await withUser(user.id, (tx) =>
    tx
      .select({ id: contents.id, number: contents.number, hook: contents.hook, title: contents.title, status: contents.status, scheduledFor: contents.scheduledFor, publishedAt: contents.publishedAt, platforms: contents.targetPlatforms })
      .from(contents)
      .where(
        and(
          eq(contents.workspaceId, ws.id),
          or(
            and(inArray(contents.status, ["SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED"]), gte(contents.scheduledFor, from), lt(contents.scheduledFor, to)),
            and(eq(contents.status, "PUBLISHED"), gte(contents.publishedAt, from), lt(contents.publishedAt, to)),
            and(eq(contents.status, "READY"), isNull(contents.scheduledFor)),
          ),
        ),
      )
      .limit(300),
  );
  const toItem = (r: (typeof rows)[number]): CalItem => {
    const at = r.status === "PUBLISHED" ? (r.publishedAt ?? r.scheduledFor) : r.scheduledFor;
    return { id: r.id, number: r.number, hook: r.hook ?? r.title, status: r.status, localDate: at ? localDateString(at, tz) : null, localTime: at ? localTimeString(at, tz) : null, platforms: r.platforms, draggable: r.status === "SCHEDULED" || r.status === "READY" };
  };
  const items = rows.filter((r) => r.status !== "READY" || r.scheduledFor).map(toItem);
  const tray = rows.filter((r) => r.status === "READY" && !r.scheduledFor).map(toItem);
  const times = [...new Set([...ws.postingSchedule, ...items.map((i) => i.localTime).filter((t): t is string => Boolean(t))])].sort();
  const days: CalDay[] = dayList.map((d) => {
    const [, m, dd] = d.split("-");
    return { date: d, label: `${dd}/${m}`, weekday: WEEKDAYS[localWeekday(zonedToUtc(d, "12:00", tz), tz)]!, isToday: d === today, isPast: d < today };
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            Week of {days[0]!.label} – {days[6]!.label}
          </div>
          <div className="text-xs text-muted-foreground">
            Times in {tz} · posting schedule {ws.postingSchedule.join(", ")} · max {ws.maxContentPublishedPerDay}/day
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild size="icon-sm" aria-label="Previous week">
            <Link href={`/w/${slug}/calendar?week=${addLocalDays(start, -7)}`}>
              <ChevronLeft />
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/w/${slug}/calendar`}>Today</Link>
          </Button>
          <Button asChild size="icon-sm" aria-label="Next week">
            <Link href={`/w/${slug}/calendar?week=${addLocalDays(start, 7)}`}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
      </div>
      <CalendarBoard slug={slug} days={days} times={times} items={items} tray={tray} />
    </div>
  );
}
