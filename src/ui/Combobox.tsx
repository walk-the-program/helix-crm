/**
 * The type-ahead picker. One control for every place the product asks "which
 * record?" — a contact on a new deal, a company on a contact, a deal on an
 * invoice, a service on an invoice line.
 *
 * WHY THIS EXISTS. Before it, a record was picked from a `Select`: every
 * contact in the workspace, in one list, in insertion order. That is fine at
 * twelve contacts and unusable at four hundred, which is what an owner has
 * after one import. Walker's note was blunter than that — the list ran off the
 * bottom of the screen and there was no way to type.
 *
 * WHY NOT `Select`. Radix's Select is a *listbox*: its trigger owns the value
 * and its content is a menu of every option. There is no text input in the
 * pattern, and bolting one on fights the roving focus Radix already installs.
 * This is the ARIA *combobox* pattern instead — a text input that owns the
 * query, a listbox that owns the options, and `aria-activedescendant` joining
 * them so the keyboard stays in the input while the highlight moves in the
 * list.
 *
 * WHY NOT cmdk. cmdk is in the bundle already (the command palette), and it
 * would have given the filtering for free — but its filtering is the thing we
 * cannot use here. Half of these pickers search the database (`items` as an
 * async function): the returned set IS the answer, and a second client-side
 * scorer on top of it would hide rows the query already matched on a column
 * the label does not show, like a phone number. So the list is rendered
 * straight, and only the array form filters locally.
 *
 * THE POPOVER NEVER RUNS OFF THE SCREEN. This was the actual defect. Radix's
 * Popover is collision-aware when it is told to be: `avoidCollisions` flips it
 * above the trigger when there is no room below, `collisionPadding` keeps it
 * off the window edge, and `--radix-popover-content-available-height` is the
 * space that is genuinely left. The list is capped at that height (and at
 * 320px, so a picker near the top of a tall window does not draw a list the
 * height of the screen) and scrolls inside it.
 *
 * COLOUR. Nothing here is coloured. The highlighted row is `--color-selected`,
 * the menu highlight the rest of the kit uses; the check mark on the chosen row
 * is muted ink; the only non-ink colour in the component is the focus ring.
 * Dates, names and details are all plain ink — the r3 rule is that no text in
 * the product is purple or blue.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { CaretUpDown, Check, MagnifyingGlass, Plus, X } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, quietTransition } from "@/ui/styles";

export type ComboboxItem = {
  id: string;
  label: string;
  /** The quiet second line: a company, an email, a price. */
  detail?: string;
  /** Extra text the local filter matches on but never shows. */
  keywords?: string[];
};

/** Either a fixed list or a search function. A function is called on open and
 *  on every (debounced) keystroke. */
export type ComboboxItems = ComboboxItem[] | ((query: string) => Promise<ComboboxItem[]>);

const SEARCH_DEBOUNCE_MS = 140;

/** The local filter, for the array form only. Substring, case-insensitive,
 *  over the label, the detail and the keywords — so "07…" finds a contact by
 *  the phone number the row does not print. */
export function filterComboboxItems(items: ComboboxItem[], query: string): ComboboxItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true;
    if (item.detail?.toLowerCase().includes(q)) return true;
    return (item.keywords ?? []).some((k) => k.toLowerCase().includes(q));
  });
}

/** The default create row's wording. Curly quotes: this is prose, not code. */
export function defaultCreateLabel(query: string): string {
  return `Add “${query.trim()}”`;
}

/**
 * The shared list machinery: resolves `items` (array or async), debounces the
 * async form, guards against an out-of-order response, and keeps the
 * highlighted index inside the result.
 */
function useComboboxList(items: ComboboxItems, query: string, open: boolean) {
  const isAsync = typeof items === "function";
  const [asyncItems, setAsyncItems] = useState<ComboboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!isAsync || !open) return;
    const search = items as (q: string) => Promise<ComboboxItem[]>;
    const seq = ++requestRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void search(query)
        .then((next) => {
          // A slower earlier request must never overwrite a later answer.
          if (requestRef.current !== seq) return;
          setAsyncItems(next);
        })
        .catch(() => {
          if (requestRef.current !== seq) return;
          setAsyncItems([]);
        })
        .finally(() => {
          if (requestRef.current !== seq) return;
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isAsync, items, query, open]);

  const resolved = useMemo(() => {
    if (isAsync) return asyncItems;
    return filterComboboxItems(items as ComboboxItem[], query);
  }, [isAsync, items, asyncItems, query]);

  return { items: resolved, loading: isAsync && loading };
}

/** The floating list's shell: collision-aware, capped, and scrolling inside. */
function listContentClassName(): string {
  return cn(
    "z-50 flex flex-col overflow-hidden",
    "border border-[var(--color-border)] bg-[var(--color-surface-raised)]",
    "shadow-[var(--shadow-md)]",
    "w-[var(--radix-popover-trigger-width)] min-w-[220px]",
    // The cap that keeps it on screen. Radix measures the room that is
    // actually left below (or above, once it has flipped) and publishes it as
    // this variable; 320px is the taste ceiling on top of that.
    "max-h-[min(320px,var(--radix-popover-content-available-height))]",
    "focus-visible:outline-none",
  );
}

const triggerClassName = cn(
  "flex w-full h-[var(--control-h)] flex-none items-center justify-between gap-[var(--space-2)]",
  "border border-[var(--color-border-strong)]",
  "bg-[var(--color-surface)] text-[var(--color-text)]",
  "px-[var(--space-3)] text-left text-[length:var(--text-base)]",
  "enabled:hover:bg-[var(--color-hover)]",
  quietTransition,
  disabledState,
  focusRing,
);

const optionClassName = cn(
  "flex w-full cursor-default items-center gap-[var(--space-2)]",
  "min-h-[var(--control-h)] px-[var(--space-3)] py-[var(--space-1)]",
  "text-left text-[length:var(--text-base)] text-[var(--color-text)]",
  "data-[highlighted=true]:bg-[var(--color-selected)]",
);

function SearchField(props: {
  id: string;
  listboxId: string;
  activeId: string | undefined;
  value: string;
  onValueChange: (v: string) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  ariaLabel?: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-none items-center gap-[var(--space-2)] border-b border-[var(--color-border)] px-[var(--space-3)]">
      <MagnifyingGlass
        size={14}
        weight="bold"
        aria-hidden="true"
        className="flex-none text-[var(--color-text-faint)]"
      />
      <input
        ref={props.inputRef}
        id={props.id}
        data-testid="combobox-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={props.listboxId}
        aria-activedescendant={props.activeId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        aria-label={props.ariaLabel ?? props.placeholder}
        value={props.value}
        onChange={(e) => props.onValueChange(e.target.value)}
        onKeyDown={props.onKeyDown}
        placeholder={props.placeholder}
        className={cn(
          "h-[var(--control-h)] w-full flex-1 border-0 bg-transparent",
          "text-[length:var(--text-base)] text-[var(--color-text)]",
          "placeholder:text-[var(--color-text-faint)]",
          "focus:outline-none",
        )}
      />
    </div>
  );
}

function OptionRow(props: {
  id: string;
  item: ComboboxItem;
  highlighted: boolean;
  selected: boolean;
  multiple?: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const { id, item, highlighted, selected, multiple, onPick, onHover } = props;
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      data-testid="combobox-option"
      data-id={item.id}
      data-highlighted={highlighted}
      onMouseMove={onHover}
      onPointerDown={(e) => {
        // Keep the focus in the search field: a blur here would close the
        // popover before the click landed.
        e.preventDefault();
      }}
      onClick={onPick}
      className={optionClassName}
    >
      <span className="flex w-[14px] flex-none items-center justify-center text-[var(--color-text-muted)]">
        {selected ? (
          <Check size={14} weight="bold" aria-hidden="true" />
        ) : multiple ? (
          <span
            aria-hidden="true"
            className="h-[12px] w-[12px] border border-[var(--color-border-strong)]"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.detail ? (
          <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
            {item.detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Keep the highlighted row on screen.
 *
 * The list is height-capped at 320px and renders every option, so a workspace
 * with four hundred contacts — which is what an owner has after one import,
 * and the case this component was written for — put the highlight out of
 * sight after about eight presses of ArrowDown. `aria-activedescendant` told a
 * screen reader where it was; nothing told the eye (CPO finding F-LC-12).
 *
 * `block: "nearest"` is deliberate: it moves the list by the minimum needed,
 * so arrowing down one row scrolls one row rather than jumping the highlight
 * to the middle of the popover.
 *
 * The row is found with `getElementById` rather than a selector: React 19's
 * `useId` produces ids containing guillemets, which are not valid in a CSS
 * selector without escaping, and `CSS.escape` does not exist in the unit
 * suite's DOM. An id lookup needs neither.
 */
function useHighlightIntoView(
  listboxRef: RefObject<HTMLDivElement | null>,
  optionElementId: string | null,
  open: boolean,
): void {
  useEffect(() => {
    if (!open || optionElementId === null) return;
    const box = listboxRef.current;
    if (!box) return;
    const row = document.getElementById(optionElementId);
    // Only scroll a row that is actually inside this list: two open pickers
    // must not fight over the same id.
    if (row && box.contains(row) && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [listboxRef, optionElementId, open]);
}

/**
 * How far PageUp/PageDown move. A screen of rows, near enough: the cap is
 * 320px and a row is one control height, so ten is about a page and is the
 * step a listbox is expected to take.
 */
const PAGE_STEP = 10;

/** Clamp an index into [0, count - 1], with an empty list sitting at 0. */
function clampIndex(next: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, next));
}

/* -------------------------------------------------------------------------- */
/* Combobox: one value                                                        */
/* -------------------------------------------------------------------------- */

export function Combobox(props: {
  value: string | null;
  onChange: (id: string | null, item?: ComboboxItem) => void;
  items: ComboboxItems;
  placeholder?: string;
  emptyText?: string;
  /** Offer "Add “query”" when the query matches nothing. */
  onCreate?: (query: string) => void | Promise<void>;
  createLabel?: (q: string) => string;
  multiple?: false;
  disabled?: boolean;
  "aria-label"?: string;
  /** Wired by `Field` when it wraps this control: the id of its hint or error
   *  text, and whether that error is live. Without these a `<Field error>`
   *  around a Combobox showed a red sentence that no screen reader ever
   *  connected to the control (CPO finding F-LC-11). */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  autoFocus?: boolean;
  /** The chosen record, when `items` is an async search and the caller
   *  already knows its label (so the closed trigger is not blank). */
  selectedItem?: ComboboxItem | null;
  /** Show a clear affordance on the trigger once something is chosen. */
  clearable?: boolean;
  id?: string;
  className?: string;
  /** Mount with the list already open. For the component gallery and for a
   *  picker that IS the screen; not a controlled `open`. */
  defaultOpen?: boolean;
}) {
  const {
    value,
    onChange,
    items,
    placeholder = "Search",
    emptyText = "No matches",
    onCreate,
    createLabel = defaultCreateLabel,
    disabled,
    autoFocus,
    selectedItem,
    clearable,
    id,
    className,
    defaultOpen,
  } = props;
  const ariaLabel = props["aria-label"];
  const ariaDescribedBy = props["aria-describedby"];
  const ariaInvalid = props["aria-invalid"];

  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  /** The last item we were handed for the current value, so an async picker
   *  can still print a name after the list is gone. */
  const [lastChosen, setLastChosen] = useState<ComboboxItem | null>(selectedItem ?? null);

  const reactId = useId();
  const inputId = `${reactId}-input`;
  const listboxId = `${reactId}-listbox`;
  const optionId = (index: number) => `${reactId}-option-${index}`;

  const { items: list, loading } = useComboboxList(items, query, open);

  const showCreate = Boolean(onCreate) && query.trim().length > 0;
  const rowCount = list.length + (showCreate ? 1 : 0);
  const createIndex = showCreate ? list.length : -1;

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useHighlightIntoView(listboxRef, rowCount > 0 ? optionId(highlight) : null, open);

  useEffect(() => {
    if (highlight >= rowCount) setHighlight(rowCount > 0 ? rowCount - 1 : 0);
  }, [rowCount, highlight]);

  useEffect(() => {
    if (selectedItem !== undefined) setLastChosen(selectedItem);
  }, [selectedItem]);

  const displayItem = useMemo(() => {
    if (value === null) return null;
    if (Array.isArray(items)) {
      const found = items.find((item) => item.id === value);
      if (found) return found;
    }
    if (lastChosen && lastChosen.id === value) return lastChosen;
    return null;
  }, [value, items, lastChosen]);

  const commit = useCallback(
    (item: ComboboxItem) => {
      setLastChosen(item);
      onChange(item.id, item);
      setOpen(false);
      setQuery("");
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const runCreate = useCallback(async () => {
    if (!onCreate) return;
    const q = query.trim();
    setOpen(false);
    setQuery("");
    await onCreate(q);
  }, [onCreate, query]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (rowCount === 0 ? 0 : (h + 1) % rowCount));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (rowCount === 0 ? 0 : (h - 1 + rowCount) % rowCount));
        return;
      }
      if (e.key === "PageDown") {
        e.preventDefault();
        setHighlight((h) => clampIndex(h + PAGE_STEP, rowCount));
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        setHighlight((h) => clampIndex(h - PAGE_STEP, rowCount));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setHighlight(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setHighlight(rowCount > 0 ? rowCount - 1 : 0);
        return;
      }
      if (e.key === "Enter") {
        if (rowCount === 0) return;
        e.preventDefault();
        if (highlight === createIndex) void runCreate();
        else {
          const item = list[highlight];
          if (item) commit(item);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setQuery("");
        triggerRef.current?.focus();
      }
    },
    [rowCount, highlight, createIndex, list, commit, runCreate],
  );

  return (
    <RadixPopover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <RadixPopover.Trigger asChild>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          autoFocus={autoFocus}
          data-testid="combobox"
          className={cn(triggerClassName, className)}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              displayItem ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]",
            )}
          >
            {displayItem ? displayItem.label : placeholder}
          </span>
          {clearable && value !== null ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLastChosen(null);
                onChange(null);
              }}
              className="flex flex-none items-center text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
            >
              <X size={12} weight="bold" aria-hidden="true" />
            </span>
          ) : null}
          <CaretUpDown
            size={14}
            weight="bold"
            aria-hidden="true"
            className="flex-none text-[var(--color-text-muted)]"
          />
        </button>
      </RadixPopover.Trigger>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          avoidCollisions
          collisionPadding={8}
          className={listContentClassName()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <SearchField
            id={inputId}
            listboxId={listboxId}
            activeId={rowCount > 0 ? optionId(highlight) : undefined}
            value={query}
            onValueChange={setQuery}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            ariaLabel={ariaLabel}
            inputRef={inputRef}
          />
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel ?? placeholder}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-[var(--space-1)]"
          >
            {list.map((item, index) => (
              <OptionRow
                key={item.id}
                id={optionId(index)}
                item={item}
                highlighted={index === highlight}
                selected={item.id === value}
                onPick={() => commit(item)}
                onHover={() => setHighlight(index)}
              />
            ))}
            {showCreate ? (
              <div
                id={optionId(createIndex)}
                role="option"
                aria-selected={false}
                data-testid="combobox-create"
                data-highlighted={highlight === createIndex}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => void runCreate()}
                onMouseMove={() => setHighlight(createIndex)}
                className={cn(optionClassName, "border-t border-[var(--color-border)]")}
              >
                <span className="flex w-[14px] flex-none items-center justify-center text-[var(--color-text-muted)]">
                  <Plus size={14} weight="bold" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate">{createLabel(query.trim())}</span>
              </div>
            ) : null}
            {list.length === 0 && !showCreate ? (
              <div
                data-testid="combobox-empty"
                className="px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--color-text-faint)]"
              >
                {loading ? "Searching…" : emptyText}
              </div>
            ) : null}
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* MultiCombobox: many values                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The same control, kept open, with a check on every chosen row. Its one real
 * job in this round is "Add a line" on an invoice: search the services
 * catalogue, tick several, add them all at once. The trigger prints a count
 * rather than a row of chips — a chip row changes the trigger's height, and a
 * control that grows as you use it moves everything under it.
 */
export function MultiCombobox(props: {
  values: string[];
  onChange: (ids: string[]) => void;
  items: ComboboxItems;
  placeholder?: string;
  emptyText?: string;
  onCreate?: (q: string) => void | Promise<void>;
  createLabel?: (q: string) => string;
  disabled?: boolean;
  "aria-label"?: string;
  /** As on `Combobox`: wired by `Field` (CPO finding F-LC-11). */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  /** How the trigger reads once something is chosen. Default: "3 chosen". */
  summaryLabel?: (count: number) => string;
  id?: string;
  className?: string;
  /** Mount with the list already open. See `Combobox`. */
  defaultOpen?: boolean;
}) {
  const {
    values,
    onChange,
    items,
    placeholder = "Search",
    emptyText = "No matches",
    onCreate,
    createLabel = defaultCreateLabel,
    disabled,
    summaryLabel = (count) => `${count} chosen`,
    id,
    className,
    defaultOpen,
  } = props;
  const ariaLabel = props["aria-label"];
  const ariaDescribedBy = props["aria-describedby"];
  const ariaInvalid = props["aria-invalid"];

  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);

  const reactId = useId();
  const inputId = `${reactId}-input`;
  const listboxId = `${reactId}-listbox`;
  const optionId = (index: number) => `${reactId}-option-${index}`;

  const { items: list, loading } = useComboboxList(items, query, open);
  const showCreate = Boolean(onCreate) && query.trim().length > 0;
  const rowCount = list.length + (showCreate ? 1 : 0);
  const createIndex = showCreate ? list.length : -1;

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useHighlightIntoView(listboxRef, rowCount > 0 ? optionId(highlight) : null, open);

  const toggle = useCallback(
    (item: ComboboxItem) => {
      if (values.includes(item.id)) onChange(values.filter((v) => v !== item.id));
      else onChange([...values, item.id]);
    },
    [values, onChange],
  );

  const runCreate = useCallback(async () => {
    if (!onCreate) return;
    const q = query.trim();
    setQuery("");
    await onCreate(q);
  }, [onCreate, query]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (rowCount === 0 ? 0 : (h + 1) % rowCount));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (rowCount === 0 ? 0 : (h - 1 + rowCount) % rowCount));
        return;
      }
      if (e.key === "PageDown") {
        e.preventDefault();
        setHighlight((h) => clampIndex(h + PAGE_STEP, rowCount));
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        setHighlight((h) => clampIndex(h - PAGE_STEP, rowCount));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setHighlight(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setHighlight(rowCount > 0 ? rowCount - 1 : 0);
        return;
      }
      if (e.key === "Enter") {
        if (rowCount === 0) return;
        e.preventDefault();
        // The list stays open: ticking several is the point.
        if (highlight === createIndex) void runCreate();
        else {
          const item = list[highlight];
          if (item) toggle(item);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setQuery("");
        triggerRef.current?.focus();
      }
    },
    [rowCount, highlight, createIndex, list, toggle, runCreate],
  );

  return (
    <RadixPopover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <RadixPopover.Trigger asChild>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          data-testid="combobox"
          data-multiple="true"
          className={cn(triggerClassName, className)}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              values.length > 0 ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]",
            )}
          >
            {values.length > 0 ? summaryLabel(values.length) : placeholder}
          </span>
          <CaretUpDown
            size={14}
            weight="bold"
            aria-hidden="true"
            className="flex-none text-[var(--color-text-muted)]"
          />
        </button>
      </RadixPopover.Trigger>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          avoidCollisions
          collisionPadding={8}
          className={listContentClassName()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <SearchField
            id={inputId}
            listboxId={listboxId}
            activeId={rowCount > 0 ? optionId(highlight) : undefined}
            value={query}
            onValueChange={setQuery}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            ariaLabel={ariaLabel}
            inputRef={inputRef}
          />
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={ariaLabel ?? placeholder}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-[var(--space-1)]"
          >
            {list.map((item, index) => (
              <OptionRow
                key={item.id}
                id={optionId(index)}
                item={item}
                multiple
                highlighted={index === highlight}
                selected={values.includes(item.id)}
                onPick={() => toggle(item)}
                onHover={() => setHighlight(index)}
              />
            ))}
            {showCreate ? (
              <div
                id={optionId(createIndex)}
                role="option"
                aria-selected={false}
                data-testid="combobox-create"
                data-highlighted={highlight === createIndex}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => void runCreate()}
                onMouseMove={() => setHighlight(createIndex)}
                className={cn(optionClassName, "border-t border-[var(--color-border)]")}
              >
                <span className="flex w-[14px] flex-none items-center justify-center text-[var(--color-text-muted)]">
                  <Plus size={14} weight="bold" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate">{createLabel(query.trim())}</span>
              </div>
            ) : null}
            {list.length === 0 && !showCreate ? (
              <div
                data-testid="combobox-empty"
                className="px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--color-text-faint)]"
              >
                {loading ? "Searching…" : emptyText}
              </div>
            ) : null}
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
