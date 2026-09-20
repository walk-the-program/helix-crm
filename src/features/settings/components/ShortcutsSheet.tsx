/**
 * Keyboard shortcuts, shown two ways: the "/settings/shortcuts" screen and the
 * "?" sheet opened from anywhere in the app. Both render the same list
 * (`groupShortcuts(allCommands())`, src/features/settings/lib/shortcuts.ts) so
 * they can never disagree.
 *
 * One grouped inset list per command group: the command on the left, the key on
 * the right, which is how a macOS menu draws a shortcut — and the reason `Kbd`
 * is set in the system face rather than a monospace (design/apple/review.md,
 * finding 4).
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, Kbd } from "@/ui";
import {
  SettingsGroup,
  SettingsRow,
  SettingsScreenFrame,
} from "@/features/settings/components/SettingsLayout";
import {
  duplicateShortcuts,
  groupShortcuts,
  PALETTE_GROUP,
  type ShortcutRow,
} from "@/features/settings/lib/shortcuts";
import { allCommands } from "@/app/registry";

function Row(props: { row: ShortcutRow; last: boolean }) {
  const { row, last } = props;
  return (
    <SettingsRow
      label={row.label}
      className={last ? "border-b-0" : undefined}
      data-testid="shortcut-row"
    >
      {row.shortcut ? (
        /*
         * Both keys when a command has two. "or" rather than a slash: a slash
         * beside a key that IS a slash (search's ⌘/) is unreadable.
         */
        <span className="flex items-center gap-[var(--space-2)]">
          <Kbd keys={row.shortcut} />
          {row.alias ? (
            <>
              <span className="text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
                or
              </span>
              <Kbd keys={row.alias} />
            </>
          ) : null}
        </span>
      ) : null}
    </SettingsRow>
  );
}

export function ShortcutsList() {
  const groups = groupShortcuts(allCommands());
  const duplicates = duplicateShortcuts(groups);

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      {groups.map((group) => (
        <SettingsGroup
          key={group.name}
          label={group.name}
          footnote={
            group.name === PALETTE_GROUP
              ? "These have no key of their own. Press the command palette key above and type the name."
              : undefined
          }
        >
          {group.rows.map((row, index) => (
            <Row key={row.id} row={row} last={index === group.rows.length - 1} />
          ))}
        </SettingsGroup>
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
      <ShortcutsList />
    </SettingsScreenFrame>
  );
}

/**
 * The "?" sheet. `DialogContent` is already height-bound and scrolls its own
 * body with the header pinned, so this adds no scroll box of its own — two
 * nested scrollers in one panel was the old version's defect.
 */
export function ShortcutsSheet(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="shortcuts-sheet">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <ShortcutsList />
      </DialogContent>
    </Dialog>
  );
}
