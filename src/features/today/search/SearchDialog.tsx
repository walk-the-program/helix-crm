/**
 * Instant search (docs/PLAN.md item 7).
 *
 * WHY THIS IS NOT IN src/app/CommandPalette.tsx
 * ---------------------------------------------
 * It is still its own cmdk dialog, but it is no longer a second search box.
 * Wave 3 made the shell delegate: Cmd/Ctrl+K looks up the registered "search"
 * command and runs it, which opens this, and the palette moved to
 * Cmd/Ctrl+Shift+K. The footer below links back to it, so the command list is
 * one keystroke or one click away and neither panel is a dead end.
 *
 * Behaviour: types are debounced 80 ms, results are grouped by entity type in
 * a fixed order, arrows move and Enter opens (cmdk owns that), Escape closes,
 * and an empty box shows the records touched most recently rather than a blank
 * panel.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { navigate } from "wouter/use-browser-location";
import { MagnifyingGlass } from "@/ui/icons";
import { qk } from "@/app/queryClient";
import { openCommandPalette, PALETTE_SHORTCUT } from "@/app/CommandPalette";
import {
  Kbd,
  OverlayPanel,
  OverlayScrim,
  overlayHeadingClass,
  overlayRowClass,
} from "@/ui";
import { useVocabulary } from "@/app/vocabulary";
import {
  GROUP_HEADINGS,
  recentRecords,
  searchRows,
  type SearchRow,
} from "@/db/repos/search";

/** PLAN item 7's budget is 50 ms per query; 80 ms of debounce sits under a keystroke. */
export const SEARCH_DEBOUNCE_MS = 80;

/** Debounce a value, so a fast typist fires one query rather than nine. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}

function ResultItem(props: { row: SearchRow; onPick: (row: SearchRow) => void }) {
  const { row, onPick } = props;
  return (
    <Command.Item
      value={`${row.entityType}:${row.entityId}`}
      keywords={[row.label, row.subtitle ?? ""]}
      onSelect={() => onPick(row)}
      className={overlayRowClass}
    >
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[length:var(--text-base)] font-medium text-[var(--color-text)]"
          title={row.label}
        >
          {row.label}
        </span>
        {row.subtitle ? (
          <span
            className="block truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
            title={row.subtitle}
          >
            {row.subtitle}
          </span>
        ) : null}
      </span>
    </Command.Item>
  );
}

export function SearchDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { open, onOpenChange } = props;
  const vocabulary = useVocabulary();
  const [value, setValue] = useState("");
  const debounced = useDebounced(value, SEARCH_DEBOUNCE_MS);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmed = debounced.trim();

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  const results = useQuery({
    queryKey: qk.search(trimmed),
    queryFn: () => searchRows(trimmed, { perType: 5, limit: 50 }),
    enabled: open && trimmed.length > 0,
    staleTime: 10_000,
  });

  const recent = useQuery({
    queryKey: [...qk.search(""), "recent"] as const,
    queryFn: () => recentRecords(8),
    enabled: open && trimmed.length === 0,
    staleTime: 10_000,
  });

  const groups = useMemo(() => results.data ?? [], [results.data]);
  const hasResults = groups.some((group) => group.rows.length > 0);

  if (!open) return null;

  function pick(row: SearchRow) {
    onOpenChange(false);
    navigate(row.href);
  }

  return (
    // Scrim, panel, row and group heading all come from the kit's shared
    // floating layer (src/ui/Overlay.tsx) — the same one the command palette
    // draws, so Cmd/Ctrl+K and Cmd/Ctrl+Shift+K put the same shape in the
    // same place and differ only in what is inside them.
    <OverlayScrim data-testid="today-search" onDismiss={() => onOpenChange(false)}>
      <OverlayPanel>
        <Command
          label="Search records"
          shouldFilter={false}
          loop
          className="w-full"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onOpenChange(false);
            }
          }}
        >
          <div className="flex items-center gap-[var(--space-3)] border-b border-[var(--color-border)] px-[var(--space-4)] py-[var(--space-3)]">
            <MagnifyingGlass
              size={18}
              weight="regular"
              aria-hidden="true"
              className="flex-none text-[var(--color-text-faint)]"
            />
            <Command.Input
              ref={inputRef}
              autoFocus
              value={value}
              onValueChange={setValue}
              placeholder={`Search contacts, companies, ${vocabulary.lowerMany} and notes`}
              className="w-full border-0 bg-transparent text-[length:var(--text-lg)] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
            />
          </div>

          <Command.List className="max-h-[420px] overflow-y-auto p-[var(--space-2)]">
            {trimmed.length === 0 ? (
              <Command.Group heading={<span className={overlayHeadingClass}>Recent</span>}>
                {(recent.data ?? []).map((row) => (
                  <ResultItem key={`${row.entityType}-${row.entityId}`} row={row} onPick={pick} />
                ))}
                {recent.isFetched && (recent.data ?? []).length === 0 ? (
                  <p className="px-[var(--space-3)] py-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    Nothing to show yet. Import a spreadsheet or add a contact and
                    it will be findable from here.
                  </p>
                ) : null}
              </Command.Group>
            ) : results.isFetching && !hasResults ? (
              <p className="px-[var(--space-3)] py-[var(--space-5)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Searching.
              </p>
            ) : !hasResults ? (
              <div className="px-[var(--space-3)] py-[var(--space-5)]">
                <p className="text-[length:var(--text-base)] text-[var(--color-text)]">
                  Nothing matches &ldquo;{trimmed}&rdquo;.
                </p>
                <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  Search looks at names, companies, phone numbers, email addresses
                  and the text of every note.
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <Command.Group
                  key={group.entityType}
                  heading={<span className={overlayHeadingClass}>{GROUP_HEADINGS[group.entityType]}</span>}
                >
                  {group.rows.map((row) => (
                    <ResultItem key={`${row.entityType}-${row.entityId}`} row={row} onPick={pick} />
                  ))}
                </Command.Group>
              ))
            )}
          </Command.List>

          {/*
            The way back to the command list. Cmd/Ctrl+K reaches search, so the
            palette needs a door that is visible from in here as well as its own
            Cmd/Ctrl+Shift+K.
          */}
          <div className="flex items-center justify-between border-t border-[var(--color-border)] px-[var(--space-4)] py-[var(--space-2)]">
            <span className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
              Searching contacts, companies, {vocabulary.lowerMany} and notes
            </span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                openCommandPalette();
              }}
              className="inline-flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            >
              Commands
              <Kbd keys={PALETTE_SHORTCUT} />
            </button>
          </div>
        </Command>
      </OverlayPanel>
    </OverlayScrim>
  );
}
