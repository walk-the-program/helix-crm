/**
 * Keyboard shortcuts, shown two ways: the "/settings/shortcuts" screen and
 * the "?" sheet opened from anywhere in the app. Both render the same list
 * (`groupShortcuts(allCommands())`, src/features/settings/lib/shortcuts.ts)
 * so they can never disagree.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, Kbd } from "@/ui";
import { SettingsScreenFrame } from "@/features/settings/components/SettingsLayout";
import {
  duplicateShortcuts,
  groupShortcuts,
  type ShortcutRow,
} from "@/features/settings/lib/shortcuts";
import { allCommands } from "@/app/registry";

function Row(props: { row: ShortcutRow }) {
  const { row } = props;
  return (
    <div
      data-testid="shortcut-row"
      data-shortcut-id={row.id}
      className="flex min-h-[var(--control-h)] items-center justify-between gap-[var(--space-4)] border-b border-[var(--color-border)] py-[var(--space-2)] last:border-b-0"
    >
      <span className="text-[length:var(--text-base)] text-[var(--color-text)]">{row.label}</span>
      {row.shortcut ? (
        <Kbd keys={row.shortcut} />
      ) : (
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-faint)]" aria-label="No shortcut">
          —
        </span>
      )}
    </div>
  );
}

export function ShortcutsList() {
  const groups = groupShortcuts(allCommands());
  const duplicates = duplicateShortcuts(groups);

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      {groups.map((group) => (
        <div key={group.name} className="flex flex-col">
          <h2 className="text-[length:var(--text-sm)] font-semibold text-[var(--color-text-muted)] pb-[var(--space-2)]">
            {group.name}
          </h2>
          <div className="flex flex-col">
            {group.rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </div>
        </div>
      ))}
      {duplicates.length > 0 ? (
        <p className="text-[length:var(--text-sm)] text-[var(--color-warning-ink)]">
          {duplicates.length === 1
            ? `${duplicates[0]} is assigned to more than one command.`
            : `These keys are assigned to more than one command: ${duplicates.join(", ")}.`}
        </p>
      ) : null}
    </div>
  );
}

export function ShortcutsScreen() {
  return (
    <SettingsScreenFrame
      title="Keyboard shortcuts"
      testId="settings-shortcuts"
      subtitle="Every key this app answers to. Also opens with ?."
    >
      <div className="max-w-[560px]">
        <ShortcutsList />
      </div>
    </SettingsScreenFrame>
  );
}

export function ShortcutsSheet(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="shortcuts-sheet">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-[var(--space-2)]">
          <ShortcutsList />
        </div>
      </DialogContent>
    </Dialog>
  );
}
