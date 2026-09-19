/**
 * New leads: deals created in the last seven days that nobody has worked yet.
 *
 * "Not worked yet" means no activity the owner wrote. The website poller
 * always writes a system entry when a lead lands, so counting system rows
 * would empty this section before he ever saw it — see
 * `deals.newLeads()`.
 *
 * Every row shows where the lead came from, because that is the one fact that
 * changes how he opens the call, and carries a single obvious action: log the
 * call he just made. Logging it takes the row off this list, which is the
 * whole point — the section is a to-do list that empties itself.
 */

import { useState } from "react";
import { Link } from "wouter";
import { Phone, PhoneCall } from "@/ui/icons";
import { Badge, Button, toast } from "@/ui";
import { Row, Section } from "@/features/today/components/Section";
import {
  LogCallDialog,
  type LogCallTarget,
} from "@/features/today/components/LogCallDialog";
import {
  NEW_LEAD_WINDOW_DAYS,
  useLogCall,
  useNewLeads,
} from "@/features/today/lib/useToday";
import type { NewLead } from "@/db/repos/deals";
import { openTel } from "@/lib/actions";
import { formatMoney } from "@/lib/money";
import { formatRelative } from "@/lib/dates";

function leadName(lead: NewLead): string {
  const person = `${lead.contactFirstName ?? ""} ${lead.contactLastName ?? ""}`.trim();
  return person || lead.companyName || lead.title;
}

export function NewLeadsSection() {
  const { data, isLoading } = useNewLeads();
  const logCall = useLogCall();
  const [target, setTarget] = useState<LogCallTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const leads = data ?? [];

  async function call(lead: NewLead) {
    if (!lead.contactPhone) return;
    try {
      const result = await openTel(lead.contactPhone, {
        contactId: lead.contactId,
        companyId: lead.companyId,
        dealId: lead.dealId,
      });
      toast.info(`Calling ${lead.contactPhone}`, {
        duration: 12000,
        action: { label: result.logLabel, onClick: () => void result.logThis() },
      });
    } catch {
      toast.error(`The phone app did not open. Call ${lead.contactPhone} directly.`);
    }
  }

  return (
    <>
      <Section
        id="new-leads"
        title="New leads"
        count={leads.length}
        note={`Last ${NEW_LEAD_WINDOW_DAYS} days, nobody has called them yet`}
        isLoading={isLoading}
        isEmpty={leads.length === 0}
        empty={{
          title: "No new leads waiting",
          description:
            "A lead lands here when a deal is created and nobody has logged a call, an email or a note against it yet. Quote requests from a connected website arrive here on their own.",
        }}
      >
        {leads.map((lead) => {
          const name = leadName(lead);
          const detail = [
            lead.title,
            lead.companyName && lead.companyName !== name ? lead.companyName : null,
            formatRelative(lead.createdAt),
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <Row
              key={lead.dealId}
              badge={
                <Badge tone="neutral">{lead.sourceName ?? "No source"}</Badge>
              }
              title={
                <Link
                  href={lead.contactId ? `/contacts/${lead.contactId}` : `/deals/${lead.dealId}`}
                  className="text-[var(--color-text)] no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                >
                  {name}
                </Link>
              }
              titleText={name}
              subtitle={detail}
              subtitleText={detail}
              money={
                lead.valueCents > 0
                  ? formatMoney(lead.valueCents, lead.currency)
                  : undefined
              }
              actions={
                <>
                  {lead.contactPhone ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconLeft={<Phone size={16} weight="bold" aria-hidden="true" />}
                      onClick={() => void call(lead)}
                    >
                      Call
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    iconLeft={<PhoneCall size={16} weight="bold" aria-hidden="true" />}
                    onClick={() => {
                      setTarget({
                        name,
                        contactId: lead.contactId,
                        companyId: lead.companyId,
                        dealId: lead.dealId,
                      });
                      setDialogOpen(true);
                    }}
                  >
                    Log a call
                  </Button>
                </>
              }
            />
          );
        })}
      </Section>

      <LogCallDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        target={target}
        saving={logCall.isPending}
        onSave={async (body) => {
          if (!target) return;
          await logCall.mutateAsync({
            body,
            contactId: target.contactId,
            companyId: target.companyId,
            dealId: target.dealId,
          });
          toast.success(`Call logged for ${target.name}.`);
        }}
      />
    </>
  );
}
