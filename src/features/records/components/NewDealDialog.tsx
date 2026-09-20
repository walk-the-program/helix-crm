/**
 * Creating a deal. Required: a title and a stage, and the stage defaults to
 * the first one, so the fast path is type a title and press Enter.
 */
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FormRow,
  Input,
} from "@/ui";
import * as dealsRepo from "@/db/repos/deals";
import { parseMoneyToCents } from "@/lib/money";
import { useVocabulary } from "@/app/vocabulary";
import {
  CompanyPicker,
  ContactPicker,
  companyAfterContactPick,
  SourcePicker,
  StagePicker,
} from "@/features/records/components/Pickers";
import {
  invalidateRecords,
  newBatchId,
  offerUndoCreate,
  reportError,
} from "@/features/records/lib/mutations";

export function NewDealDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string | undefined;
  defaultStageId: string | undefined;
  defaultContactId?: string | null;
  defaultCompanyId?: string | null;
  onCreated?: (dealId: string) => void;
}) {
  const vocabulary = useVocabulary();
  const [title, setTitle] = useState("");
  const [stageId, setStageId] = useState(props.defaultStageId ?? "");
  const [value, setValue] = useState("");
  const [contactId, setContactId] = useState<string | null>(props.defaultContactId ?? null);
  const [companyId, setCompanyId] = useState<string | null>(props.defaultCompanyId ?? null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [expectedOn, setExpectedOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (props.open) {
      setStageId(props.defaultStageId ?? "");
      setContactId(props.defaultContactId ?? null);
      setCompanyId(props.defaultCompanyId ?? null);
    } else {
      setTitle("");
      setValue("");
      setExpectedOn("");
      setSourceId(null);
      setError(null);
    }
  }, [props.open, props.defaultStageId, props.defaultContactId, props.defaultCompanyId]);

  async function create() {
    if (title.trim().length === 0) {
      setError(`Give the ${vocabulary.lower} a title.`);
      return;
    }
    if (stageId === "") {
      setError("Pick a stage.");
      return;
    }
    setError(null);
    setSaving(true);
    const batchId = newBatchId();
    try {
      const deal = await dealsRepo.create(
        {
          title: title.trim(),
          stageId,
          valueCents: parseMoneyToCents(value) ?? 0,
          contactId,
          companyId,
          sourceId,
          expectedOn: expectedOn.trim().length > 0 ? expectedOn : null,
        },
        { batchId },
      );
      await invalidateRecords();
      offerUndoCreate(batchId, deal.title);
      props.onOpenChange(false);
      props.onCreated?.(deal.id);
    } catch (err) {
      reportError(err, `That ${vocabulary.lower} did not save.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{vocabulary.newOne}</DialogTitle>
          <DialogDescription>
            A title and a stage are all that is required. Everything else can follow.
          </DialogDescription>
        </DialogHeader>

        <FormRow>
          <Field label="Title" error={error ?? undefined}>
            <Input
              autoFocus
              value={title}
              placeholder="Spring cleanup and mulch"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void create();
                }
              }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-[var(--space-4)]">
            <div>
              <label
                htmlFor="new-deal-stage"
                className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
              >
                Stage
              </label>
              <StagePicker
                id="new-deal-stage"
                label="Stage"
                pipelineId={props.pipelineId}
                value={stageId}
                onChange={setStageId}
              />
            </div>
            <Field label="Value">
              <Input
                value={value}
                placeholder="1,500.00"
                inputMode="decimal"
                className="money"
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-[var(--space-4)]">
            <div>
              <label
                htmlFor="new-deal-contact"
                className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
              >
                Contact
              </label>
              <ContactPicker
                id="new-deal-contact"
                label="Contact"
                value={contactId}
                onChange={(id, contact) => {
                  setContactId(id);
                  setCompanyId((current) => companyAfterContactPick(contact, current));
                }}
              />
            </div>
            <div>
              <label
                htmlFor="new-deal-company"
                className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
              >
                Company
              </label>
              <CompanyPicker
                id="new-deal-company"
                label="Company"
                value={companyId}
                onChange={setCompanyId}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-[var(--space-4)]">
            <Field label="Expected date">
              <Input
                type="date"
                value={expectedOn}
                onChange={(event) => setExpectedOn(event.target.value)}
              />
            </Field>
            <div>
              <label
                htmlFor="new-deal-source"
                className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
              >
                Source
              </label>
              <SourcePicker
                id="new-deal-source"
                label="Source"
                value={sourceId}
                onChange={setSourceId}
              />
            </div>
          </div>
        </FormRow>

        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void create()}>
            Create {vocabulary.lower}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
