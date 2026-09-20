/**
 * Stage management: add, rename, reorder, recolour from the stage ramp, set
 * quiet days, and delete.
 *
 * Deleting a stage that still holds deals is refused until the owner says
 * where they go, so the delete step asks for the target first and passes it to
 * `stages.remove`, which moves them inside one transaction.
 */
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "@/ui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Input,
  Select,
} from "@/ui";
import * as stagesRepo from "@/db/repos/stages";
import type { Stage } from "@/db/repos/stages";
import { useStageSummary } from "@/features/records/lib/hooks";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";

/** The ramp DESIGN.md §5 fixes. Stage colour is a token, never a hex. */
const STAGE_RAMP = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  value: `var(--stage-${n})`,
  label: `Stage colour ${n}`,
}));

export function StageManagerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  stages: Stage[];
  vocabularyMany: string;
}) {
  const { stages, pipelineId } = props;
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Stage | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sweepCandidates, setSweepCandidates] = useState<Stage[] | null>(null);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  const { data: summary } = useStageSummary(pipelineId);
  const dealCountByStage = new Map((summary ?? []).map((row) => [row.stageId, row.dealCount]));

  useEffect(() => {
    if (!props.open) {
      setName("");
      setNameError(null);
      setDeleting(null);
      setDeleteError(null);
      setSweepCandidates(null);
      setSweepMessage(null);
    }
  }, [props.open]);

  async function guard(run: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    try {
      await run();
      await invalidateRecords();
    } catch (err) {
      reportError(err, fallback);
    } finally {
      setBusy(false);
    }
  }

  async function addStage() {
    if (name.trim().length === 0) {
      setNameError("Give the stage a name.");
      return;
    }
    setNameError(null);
    const colour = STAGE_RAMP[stages.length % STAGE_RAMP.length].value;
    await guard(
      () => stagesRepo.create({ pipelineId, name: name.trim(), color: colour }),
      "That stage did not save.",
    );
    setName("");
  }

  async function move(stage: Stage, delta: number) {
    const ordered = [...stages].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((candidate) => candidate.id === stage.id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= ordered.length) return;
    const reordered = [...ordered];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(next, 0, moved);
    await guard(
      () => stagesRepo.reorder(reordered.map((candidate) => candidate.id)),
      "That order did not save.",
    );
  }

  async function confirmDelete() {
    const stage = deleting;
    if (!stage) return;
    setDeleteError(null);
    const count = await stagesRepo.dealCount(stage.id);
    if (count > 0 && moveTarget === "") {
      setDeleteError(
        `${count} ${count === 1 ? "record sits" : "records sit"} in ${stage.name}. Say where they go first.`,
      );
      return;
    }
    setBusy(true);
    try {
      await stagesRepo.remove(stage.id, moveTarget === "" ? undefined : moveTarget);
      await invalidateRecords();
      setDeleting(null);
      setMoveTarget("");
    } catch (err) {
      reportError(err, "That stage could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function openSweep() {
    setSweepMessage(null);
    const candidates = await stagesRepo.emptyRemovableCandidates(pipelineId);
    if (candidates.length === 0) {
      setSweepMessage("No empty stages to remove.");
      return;
    }
    setSweepCandidates(candidates);
  }

  async function confirmSweep() {
    setBusy(true);
    try {
      await stagesRepo.removeEmpty(pipelineId);
      await invalidateRecords();
      setSweepCandidates(null);
    } catch (err) {
      reportError(err, "Those stages could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const ordered = [...stages].sort((a, b) => a.position - b.position);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Stages</DialogTitle>
          <DialogDescription>
            The columns on the board, in order. Quiet days is how long one{" "}
            can sit here before Today asks about it — 0 turns that off.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-start justify-between gap-[var(--space-2)]">
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void openSweep()}>
            Remove empty stages
          </Button>
          {sweepMessage ? (
            <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              {sweepMessage}
            </p>
          ) : null}
        </div>

        {sweepCandidates ? (
          <div className="border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-[var(--space-4)]">
            <p className="text-[length:var(--text-base)] text-[var(--color-danger-ink)]">
              Remove{" "}
              {sweepCandidates.map((stage, i) => (
                <span key={stage.id}>
                  {i > 0 ? (i === sweepCandidates.length - 1 ? " and " : ", ") : ""}
                  <strong>{stage.name}</strong>
                </span>
              ))}
              ? {sweepCandidates.length === 1 ? "It is empty." : "They are empty."} Won
              and lost stages are never swept, even when empty.
            </p>
            <div className="mt-[var(--space-3)] flex items-center gap-[var(--space-2)]">
              <Button variant="secondary" onClick={() => setSweepCandidates(null)}>
                Keep them
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void confirmSweep()}>
                Remove {sweepCandidates.length === 1 ? "stage" : "stages"}
              </Button>
            </div>
          </div>
        ) : null}

        <div
          aria-hidden="true"
          className="section-label flex flex-wrap items-end gap-[var(--space-2)] pb-[var(--space-2)]"
        >
          <span className="min-w-[180px] flex-1">Name</span>
          <span className="w-[160px]">Colour</span>
          <span className="w-[110px]">Quiet days</span>
          <span className="w-[70px]">{props.vocabularyMany}</span>
          <span className="w-[108px]" />
        </div>

        <ul className="flex flex-col gap-[var(--space-3)]">
          {ordered.map((stage, index) => (
            <li
              key={stage.id}
              className="flex flex-wrap items-center gap-[var(--space-2)] border-b border-[var(--color-border)] pb-[var(--space-3)] last:border-0"
            >
              <div className="min-w-[180px] flex-1">
                <Input
                  id={`stage-name-${stage.id}`}
                  aria-label={`Name of the ${stage.name} stage`}
                  defaultValue={stage.name}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next.length === 0 || next === stage.name) return;
                    void guard(
                      () => stagesRepo.update(stage.id, { name: next }),
                      "That name did not save.",
                    );
                  }}
                />
              </div>

              <div className="w-[160px]">
                <div className="flex items-center gap-[var(--space-2)]">
                  <span
                    className="h-[7px] w-[7px] shrink-0"
                    style={{ background: stage.color }}
                    aria-hidden="true"
                  />
                  <Select
                    id={`stage-colour-${stage.id}`}
                    ariaLabel={`Colour for ${stage.name}`}
                    value={stage.color}
                    options={
                      STAGE_RAMP.some((option) => option.value === stage.color)
                        ? STAGE_RAMP
                        : [...STAGE_RAMP, { value: stage.color, label: "Current colour" }]
                    }
                    onValueChange={(colour) =>
                      void guard(
                        () => stagesRepo.update(stage.id, { color: colour }),
                        "That colour did not save.",
                      )
                    }
                  />
                </div>
              </div>

              <div className="w-[110px]">
                <Input
                  id={`stage-quiet-${stage.id}`}
                  aria-label={`Quiet days for ${stage.name}`}
                  type="number"
                  min={0}
                  defaultValue={stage.quietDays}
                  onBlur={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next) || next < 0 || next === stage.quietDays) return;
                    void guard(
                      () => stagesRepo.update(stage.id, { quietDays: Math.trunc(next) }),
                      "That did not save.",
                    );
                  }}
                />
              </div>

              <div
                className="w-[70px] tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
                aria-label={`${dealCountByStage.get(stage.id) ?? 0} deals in ${stage.name}`}
              >
                {dealCountByStage.get(stage.id) ?? 0}
              </div>

              <div className="flex items-center gap-[var(--space-1)]">
                <IconButton
                  label={`Move ${stage.name} earlier`}
                  size="sm"
                  disabled={index === 0 || busy}
                  icon={<ArrowUp size={16} weight="bold" aria-hidden="true" />}
                  onClick={() => void move(stage, -1)}
                />
                <IconButton
                  label={`Move ${stage.name} later`}
                  size="sm"
                  disabled={index === ordered.length - 1 || busy}
                  icon={<ArrowDown size={16} weight="bold" aria-hidden="true" />}
                  onClick={() => void move(stage, 1)}
                />
                <IconButton
                  label={`Delete ${stage.name}`}
                  size="sm"
                  variant="danger"
                  disabled={ordered.length <= 1 || busy}
                  icon={<Trash2 size={16} weight="bold" aria-hidden="true" />}
                  onClick={() => {
                    setDeleting(stage);
                    setMoveTarget("");
                    setDeleteError(null);
                  }}
                />
              </div>
            </li>
          ))}
        </ul>

        {deleting ? (
          <div className="mt-[var(--space-4)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-[var(--space-4)]">
            <p className="text-[length:var(--text-base)] text-[var(--color-danger-ink)]">
              Delete {deleting.name}? Anything still in it has to go somewhere.
            </p>
            <div className="mt-[var(--space-3)] w-[240px]">
              <label
                htmlFor="stage-move-target"
                className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
              >
                Move them to
              </label>
              <Select
                id="stage-move-target"
                ariaLabel="Stage to move them to"
                value={moveTarget === "" ? undefined : moveTarget}
                placeholder="Pick a stage"
                options={ordered
                  .filter((candidate) => candidate.id !== deleting.id)
                  .map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                onValueChange={setMoveTarget}
              />
              {deleteError ? (
                <p role="alert" className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-danger-ink)]">
                  {deleteError}
                </p>
              ) : null}
            </div>
            <div className="mt-[var(--space-3)] flex items-center gap-[var(--space-2)]">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Keep it
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void confirmDelete()}>
                Delete stage
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-[var(--space-5)] flex flex-wrap items-end gap-[var(--space-2)] border-t border-[var(--color-border)] pt-[var(--space-4)]">
          <div className="min-w-[220px] flex-1">
            <Field label="New stage" error={nameError ?? undefined}>
              <Input
                value={name}
                placeholder="Walkthrough booked"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addStage();
                  }
                }}
              />
            </Field>
          </div>
          <Button
            variant="secondary"
            loading={busy}
            iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
            onClick={() => void addStage()}
          >
            Add stage
          </Button>
        </div>

        <DialogFooter>
          <Button variant="primary" onClick={() => props.onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
