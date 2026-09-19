/**
 * The command palette. Fed by the registry: every feature's commands plus a
 * jump-to for every sidebar item.
 *
 * Since wave 3 it no longer owns Cmd/Ctrl+K. There is one search key in the
 * product: Cmd/Ctrl+K opens the Today feature's search dialog when a command
 * with the id "search" is registered, and falls back to this palette when it
 * is not (Shell.tsx does the lookup, at press time). The palette itself is on
 * **Cmd/Ctrl+Shift+K**, and the search dialog carries a footer button back to
 * it, so neither is a dead end.
 */
import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useLocation } from "wouter";
import { allCommands, allNavItems } from "@/app/registry";
import { Kbd } from "@/ui";

/** Fired on `window` to open the palette from outside the shell's React tree. */
export const OPEN_PALETTE_EVENT = "helix:open-palette";

/** The palette's shortcut, for anything that renders the key next to a label. */
export const PALETTE_SHORTCUT = "mod+shift+k";

/**
 * Open the palette from anywhere, including the search overlay, which renders
 * in its own React root and so cannot reach the shell's state.
 */
export function openCommandPalette(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
}

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, navigate] = useLocation();
  const [value, setValue] = useState("");
  const commands = useMemo(() => allCommands(), []);
  const navItems = useMemo(() => allNavItems(), []);

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  if (!open) return null;

  const run = (fn: () => void | Promise<void>) => {
    onOpenChange(false);
    void fn();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-text)]/25 p-[var(--space-8)]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <Command
        label="Command palette"
        className="w-full max-w-[640px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-lg)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenChange(false);
        }}
      >
        <Command.Input
          autoFocus
          value={value}
          onValueChange={setValue}
          placeholder="Search, or type a command"
          className="w-full border-0 border-b border-[var(--color-border)] bg-transparent px-[var(--space-4)] py-[var(--space-4)] text-[length:var(--text-base)] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
        />
        <Command.List className="max-h-[360px] overflow-y-auto p-[var(--space-2)]">
          <Command.Empty className="px-[var(--space-4)] py-[var(--space-5)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Nothing matches that yet.
          </Command.Empty>

          <Command.Group
            heading="Go to"
            className="px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
          >
            {navItems.map((item) => (
              <Command.Item
                key={item.to}
                value={`go ${item.label}`}
                onSelect={() => run(() => navigate(item.to))}
                className="flex h-[44px] cursor-pointer items-center gap-[var(--space-3)] rounded-[var(--radius-md)] px-[var(--space-3)] text-[length:var(--text-base)] text-[var(--color-text)] data-[selected=true]:bg-[var(--color-accent-soft)]"
              >
                {item.icon ? <item.icon size={16} aria-hidden /> : null}
                {item.label}
              </Command.Item>
            ))}
          </Command.Group>

          {commands.length > 0 ? (
            <Command.Group
              heading="Actions"
              className="px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
            >
              {commands.map((command) => (
                <Command.Item
                  key={command.id}
                  value={`${command.label} ${(command.keywords ?? []).join(" ")}`}
                  onSelect={() => run(command.run)}
                  className="flex h-[44px] cursor-pointer items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] px-[var(--space-3)] text-[length:var(--text-base)] text-[var(--color-text)] data-[selected=true]:bg-[var(--color-accent-soft)]"
                >
                  <span>{command.label}</span>
                  {command.shortcut ? <Kbd keys={command.shortcut} /> : null}
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </div>
  );
}
