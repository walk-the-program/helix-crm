/**
 * Today's schedule: the day's timed visits, in the order the owner actually
 * has to leave the house for them.
 *
 * It reads `scheduleItems` (schedule/lib/feed.ts) rather than tasks directly,
 * because a visit is one of six kinds the Schedule already unions from tasks,
 * jobs, reminders and invoices (decision PX-6) - this section and the
 * Schedule screen itself have to agree on what "today" contains, and there is
 * no second, denormalised answer to ask.
 *
 * A day with nothing timed on it draws nothing at all here - no heading, no
 * empty state. Due now already tells him what is open today regardless of
 * time; this section only has something to say once one of those has a clock
 * on it, and a panel that always exists just to say "nothing at nine
 * o'clock" is a panel that trained him to stop reading it.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/ui";
import { qk } from "@/app/queryClient";
import { Row, Section } from "@/features/today/components/Section";
import { scheduleItems } from "@/features/schedule/lib/feed";
import { itemsOn } from "@/features/schedule/lib/types";
import { timeLabel } from "@/features/schedule/lib/labels";
import { useFormats } from "@/app/formats";
import { todayLocal } from "@/lib/dates";

const linkClassName =
  "text-[var(--color-text-muted)] no-underline underline-offset-2 hover:text-[var(--color-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]";

export function TodaySchedule() {
  const today = todayLocal();
  const formats = useFormats();

  const { data, isLoading } = useQuery({
    queryKey: qk.schedule(today, today),
    queryFn: () => scheduleItems({ from: today, to: today }),
  });

  // Everything on the day, timed first by construction (itemsOn), then cut to
  // only the timed ones: an all-day row already has a home, either on Due now
  // (a task) or nowhere Today reports on at all (a job's expected date, a
  // reminder, an invoice), and does not belong in an agenda that exists to
  // answer "at what time".
  const timed = itemsOn(data ?? [], today).filter((item) => item.at !== null);

  if (isLoading || timed.length === 0) return null;

  return (
    <Section id="today-schedule" title="Today's schedule" count={timed.length} isLoading={false} isEmpty={false}>
      {timed.map((item) => (
        <Row
          key={item.id}
          badge={<Badge tone="neutral">{timeLabel(item, formats.locale)}</Badge>}
          title={item.title}
          titleText={item.title}
          subtitle={
            item.who ? (
              <>
                <Link href={item.who.href} className={linkClassName}>
                  {item.who.label}
                </Link>
                {item.place ? (
                  <span className="text-[var(--color-text-faint)]"> · {item.place}</span>
                ) : null}
              </>
            ) : (
              <Link href={item.href} className={linkClassName}>
                {item.place ?? "Open"}
              </Link>
            )
          }
          subtitleText={[item.who?.label, item.place].filter(Boolean).join(" · ") || undefined}
        />
      ))}
    </Section>
  );
}
