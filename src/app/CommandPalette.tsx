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
import { MagnifyingGlass } from "@/ui/icons";
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
    /*
     * A Spotlight panel: a floating sheet held a fifth of the way down the
     * window over a light dim, with one hairline and the single diffuse
     * shadow. No chrome, no title bar, no icons in the list.
     */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-overlay)] p-[var(--space-8)] pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <Command
        label="Command palette"
        className="w-full max-w-[600px] overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-lg)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenChange(false);
        }}
      >
        <div className="flex items-center gap-[var(--space-3)] border-b border-[var(--color-border)] px-[var(--space-4)]">
          <MagnifyingGlass
            size={18}
            weight="regular"
            aria-hidden
            className="flex-none text-[var(--color-text-faint)]"
          />
          <Command.Input
            autoFocus
            value={value}
            onValueChange={setValue}
            placeholder="Search, or type a command"
            className="w-full border-0 bg-transparent py-[var(--space-4)] text-[length:var(--text-lg)] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
          />
        </div>
        <Command.List className="max-h-[368px] overflow-y-auto p-[var(--space-2)]">
          <Command.Empty className="px-[var(--space-3)] py-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Nothing matches that yet.
          </Command.Empty>

          <Command.Group
            heading="Go to"
            className={[
              "[&_[cmdk-group-heading]]:px-[var(--space-3)]",
              "[&_[cmdk-group-heading]]:pb-[var(--space-1)]",
              "[&_[cmdk-group-heading]]:pt-[var(--space-2)]",
              "[&_[cmdk-group-heading]]:text-[length:var(--text-label)]",
              "[&_[cmdk-group-heading]]:font-semibold",
              "[&_[cmdk-group-heading]]:uppercase",
              "[&_[cmdk-group-heading]]:tracking-[var(--tracking-label)]",
              "[&_[cmdk-group-heading]]:text-[var(--color-text-faint)]",
            ].join(" ")}
          >
            {navItems.map((item) => (
              <Command.Item
                key={item.to}
                value={`go ${item.label}`}
                onSelect={() => run(() => navigate(item.to))}
                className="flex h-[var(--row-h)] cursor-default items-center gap-[var(--space-3)] px-[var(--space-3)] text-[length:var(--text-base)] text-[var(--color-text)] data-[selected=true]:bg-[var(--color-selected)]"
              >
                {item.label}
              </Command.Item>
            ))}
          </Command.Group>

          {commands.length > 0 ? (
            <Command.Group
              heading="Actions"
              className={[
                "[&_[cmdk-group-heading]]:px-[var(--space-3)]",
                "[&_[cmdk-group-heading]]:pb-[var(--space-1)]",
                "[&_[cmdk-group-heading]]:pt-[var(--space-3)]",
                "[&_[cmdk-group-heading]]:text-[length:var(--text-label)]",
                "[&_[cmdk-group-heading]]:font-semibold",
                "[&_[cmdk-group-heading]]:uppercase",
                "[&_[cmdk-group-heading]]:tracking-[var(--tracking-label)]",
                "[&_[cmdk-group-heading]]:text-[var(--color-text-faint)]",
              ].join(" ")}
            >
              {commands.map((command) => (
                <Command.Item
                  key={command.id}
                  value={`${command.label} ${(command.keywords ?? []).join(" ")}`}
                  onSelect={() => run(command.run)}
                  className="flex h-[var(--row-h)] cursor-default items-center justify-between gap-[var(--space-3)] px-[var(--space-3)] text-[length:var(--text-base)] text-[var(--color-text)] data-[selected=true]:bg-[var(--color-selected)]"
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
