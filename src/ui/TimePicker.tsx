/**
 * A time field the owner types into or picks from a scrolling list — never
 * the browser's native `<input type="time">`.
 *
 * WHY THIS EXISTS. The native control renders whatever the OS/browser gives
 * it: a spinner on Windows, a wheel on iOS, three separate un-styleable
 * segments everywhere else. None of it takes a token, none of it takes the
 * product's type, and Walker's own words on it were "looks like a web page
 * and does not belong in this product." So this is a real field — an `Input`
 * that happens to also open a list — built the same way `Combobox` was: the
 * ARIA *combobox* pattern, a text input that owns the query and a listbox
 * that owns the options, joined by `aria-activedescendant` so the keyboard
 * never has to leave the field.
 *
 * WHY A LIST *AND* A PARSER. A list alone means fifteen clicks to get from
 * "00:00" to "9:30 PM". A parser alone means no discoverability — nobody
 * learns "930" means 9:30 by staring at an empty field. So both: the list is
 * every offered time at `step` minutes, and `parseTimeInput` (exported,
 * tested on its own) reads whatever an owner actually types — "9", "9a",
 * "930", "0930", "9:30 pm", "21:30" — and resolves it to the one internal
 * shape, 24-hour "HH:MM". The list can only ever offer round numbers; the
 * parser is what lets someone type "9:07" and have it just work.
 *
 * WHY 24-HOUR INTERNALLY, LOCALE ON DISPLAY. Every consumer of `value` — sort
 * order, comparison, storage — wants one unambiguous shape, and "HH:MM" in
 * 24-hour sorts and compares as a string with no am/pm arithmetic anywhere
 * near the data model. What's on screen is a different question, answered by
 * `Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })` on
 * a throwaway local `Date` — a US workspace reads "9:30 AM", an ISO one reads
 * "09:30", and neither format is ever hard-coded here.
 *
 * THE POPOVER NEVER RUNS OFF THE SCREEN, same technique as `Combobox`:
 * `collisionPadding` keeps it off the window edge and the list is capped at
 * the smaller of 240px and the room Radix actually measured underneath it
 * (`--radix-popover-content-available-height`), then scrolls inside that.
 *
 * COLOUR. Times are plain ink, full stop — the r3 rule is that no text in the
 * product is purple or blue. The keyboard-highlighted row takes
 * `--color-selected`, the same menu highlight `Select` and `Combobox` use;
 * the chosen time gets a check mark in muted ink, not a fill of its own. The
 * only other non-ink colour anywhere in the control is the focus ring.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Check, Clock, X } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, quietTransition } from "@/ui/styles";

/* -------------------------------------------------------------------------- */
/* parsing: the most valuable thing in this file                              */
/* -------------------------------------------------------------------------- */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

const TIME_INPUT_RE = /^(\d{1,4})(?::(\d{2}))?(am|pm|a|p)?$/;

/**
 * Reads whatever an owner typed into the field and resolves it to 24-hour
 * "HH:MM", or `null` if the text is not a time.
 *
 * The shapes it accepts, in the order they're checked: a bare hour ("9"), an
 * hour with a meridiem ("9a", "9am", "9 pm"), a compact 3- or 4-digit clock
 * ("930", "0930"), a colon time with or without a meridiem ("9:30",
 * "9:30 pm"), and a 24-hour colon time ("21:30"). Whitespace inside the
 * string never changes the reading — "9 : 30 pm" and "9:30pm" parse the same
 * — because an owner typing on the move does not stop to get spacing right.
 *
 * `opts.prefer24h` is a strict mode: when set, a meridiem suffix makes the
 * input invalid rather than reinterpreting it, for a caller that only ever
 * wants a 24-hour reading accepted as such.
 */
export function parseTimeInput(raw: string, opts?: { prefer24h?: boolean }): string | null {
  const compact = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!compact) return null;

  const match = TIME_INPUT_RE.exec(compact);
  if (!match) return null;

  const [, digits, colonMinutes, meridiemRaw] = match;

  if (meridiemRaw && opts?.prefer24h) return null;

  let hour: number;
  let minute: number;

  if (colonMinutes !== undefined) {
    hour = Number(digits);
    minute = Number(colonMinutes);
  } else if (digits.length <= 2) {
    hour = Number(digits);
    minute = 0;
  } else if (digits.length === 3) {
    hour = Number(digits.slice(0, 1));
    minute = Number(digits.slice(1));
  } else {
    hour = Number(digits.slice(0, 2));
    minute = Number(digits.slice(2));
  }

  if (meridiemRaw) {
    if (hour < 1 || hour > 12) return null;
    const isPm = meridiemRaw.startsWith("p");
    hour = hour % 12;
    if (isPm) hour += 12;
  }

  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;

  return `${pad2(hour)}:${pad2(minute)}`;
}

/** True when `time` ("HH:MM") is a real, in-range 24-hour clock string. */
function isValidTimeValue(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function isWithinRange(time: string, min: string | undefined, max: string | undefined): boolean {
  if (min && time < min) return false;
  if (max && time > max) return false;
  return true;
}

/** Every offered time from 00:00 to 23:45 (or wherever `step` lands), in order. */
function generateTimeOptions(step: number): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    options.push(`${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`);
  }
  return options;
}

/** The locale-formatted label, e.g. "9:30 AM" or "09:30" — never hard-coded. */
function formatTimeLabel(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const d = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
}

function normalizeForFilter(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

/** Substring match on the displayed label, plus an exact match on whatever
 *  the typed text itself parses to — so "930" finds 09:30 even though its
 *  label reads "9:30 AM" and never contains "930" as a substring. */
function filterTimeOptions(options: string[], query: string): string[] {
  const q = normalizeForFilter(query);
  if (!q) return options;
  const parsed = parseTimeInput(query);
  return options.filter((time) => {
    if (parsed && parsed === time) return true;
    return normalizeForFilter(formatTimeLabel(time)).includes(q);
  });
}

/* -------------------------------------------------------------------------- */
/* styling: the trigger matches Input/Select exactly, the list matches Combobox */
/* -------------------------------------------------------------------------- */

const triggerClassName = cn(
  "w-full h-[var(--control-h)]",
  "border border-[var(--color-border-strong)] bg-[var(--color-surface)]",
  "text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]",
  "px-[var(--space-3)] text-[length:var(--text-base)]",
  quietTransition,
  focusRing,
  disabledState,
);

const optionClassName = cn(
  "flex w-full cursor-default items-center gap-[var(--space-2)]",
  "min-h-[var(--control-h-sm)] px-[var(--space-3)]",
  "text-left text-[length:var(--text-base)] text-[var(--color-text)]",
  "data-[highlighted=true]:bg-[var(--color-selected)] data-[highlighted=true]:outline-none",
  "data-[disabled=true]:opacity-50 data-[disabled=true]:pointer-events-none",
);

/* -------------------------------------------------------------------------- */
/* TimePicker                                                                 */
/* -------------------------------------------------------------------------- */

export function TimePicker(props: {
  value: string | null;
  onChange: (v: string | null) => void;
  /** Minute granularity of the offered list. The parser accepts any minute
   *  regardless of this — it only shapes what the list offers. */
  step?: 5 | 15 | 30;
  disabled?: boolean;
  "aria-label"?: string;
  placeholder?: string;
  /** Shows a clear affordance (accessible name "Clear time") once a value is set. */
  clearable?: boolean;
  /** "HH:MM". Times before it are disabled in the list and rejected when typed. */
  min?: string;
  /** "HH:MM". Times after it are disabled in the list and rejected when typed. */
  max?: string;
  id?: string;
  className?: string;
}) {
  const {
    value,
    onChange,
    step = 15,
    disabled,
    placeholder = "Select a time",
    clearable,
    min,
    max,
    id,
    className,
  } = props;
  const ariaLabel = props["aria-label"];

  const reactId = useId();
  const listboxId = `${reactId}-listbox`;
  const optionElementId = (time: string) => `${reactId}-option-${time.replace(":", "")}`;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());

  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState(() => (value ? formatTimeLabel(value) : ""));
  const [filterActive, setFilterActive] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(value);

  // Keep the displayed text in step with an externally-changed value, as
  // long as the owner is not mid-edit (an open, filtering field is theirs).
  useEffect(() => {
    if (filterActive) return;
    setInputText(value ? formatTimeLabel(value) : "");
  }, [value, filterActive]);

  const allOptions = useMemo(() => generateTimeOptions(step), [step]);

  const isOptionDisabled = useCallback((time: string) => !isWithinRange(time, min, max), [min, max]);

  const visibleOptions = useMemo(() => {
    if (!filterActive) return allOptions;
    return filterTimeOptions(allOptions, inputText);
  }, [allOptions, filterActive, inputText]);

  const activeOptions = useMemo(
    () => visibleOptions.filter((t) => !isOptionDisabled(t)),
    [visibleOptions, isOptionDisabled],
  );

  const defaultHighlight = useCallback((): string | null => {
    if (value && activeOptions.includes(value)) return value;
    if (activeOptions.includes("09:00")) return "09:00";
    return activeOptions[0] ?? null;
  }, [value, activeOptions]);

  const openList = useCallback(() => {
    if (disabled) return;
    setFilterActive(false);
    setOpen(true);
    setHighlighted(defaultHighlight());
  }, [disabled, defaultHighlight]);

  // Scroll the highlighted time (or 09:00) into view whenever the list opens.
  useEffect(() => {
    if (!open) return;
    const target = highlighted ?? "09:00";
    const el = optionRefs.current.get(target);
    el?.scrollIntoView({ block: "nearest" });
    // Only on open: re-running this on every highlight change would fight a
    // keyboard-navigating owner who has scrolled the list themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const revertText = useCallback(() => {
    setFilterActive(false);
    setInputText(value ? formatTimeLabel(value) : "");
  }, [value]);

  const commitTime = useCallback(
    (time: string | null) => {
      setFilterActive(false);
      setInputText(time ? formatTimeLabel(time) : "");
      setHighlighted(time);
      setOpen(false);
      onChange(time);
    },
    [onChange],
  );

  const tryCommitTypedText = useCallback(
    (text: string) => {
      const parsed = parseTimeInput(text);
      if (parsed && isValidTimeValue(parsed) && isWithinRange(parsed, min, max)) {
        commitTime(parsed);
      } else {
        revertText();
      }
    },
    [commitTime, revertText, min, max],
  );

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      if (activeOptions.length === 0) return;
      const currentIndex = highlighted ? activeOptions.indexOf(highlighted) : -1;
      let nextIndex = currentIndex + direction;
      if (nextIndex < 0) nextIndex = 0;
      if (nextIndex > activeOptions.length - 1) nextIndex = activeOptions.length - 1;
      const next = activeOptions[nextIndex];
      setHighlighted(next);
      optionRefs.current.get(next)?.scrollIntoView({ block: "nearest" });
    },
    [activeOptions, highlighted],
  );

  const handleInputChange = useCallback(
    (text: string) => {
      setInputText(text);
      setFilterActive(true);
      if (!open) setOpen(true);
      const nextVisible = filterTimeOptions(allOptions, text).filter((t) => !isOptionDisabled(t));
      setHighlighted(nextVisible[0] ?? null);
    },
    [open, allOptions, isOptionDisabled],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!open) openList();
        else moveHighlight(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) openList();
        else moveHighlight(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (open && highlighted && activeOptions.includes(highlighted)) {
          commitTime(highlighted);
        } else {
          tryCommitTypedText(inputText);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        revertText();
      }
      // Tab needs no handler of its own: the browser moves focus and the
      // resulting blur commits whatever was typed, same as a mouse-driven blur.
    },
    [open, openList, moveHighlight, highlighted, activeOptions, commitTime, tryCommitTypedText, inputText, revertText],
  );

  const handleBlur = useCallback(() => {
    setOpen(false);
    tryCommitTypedText(inputText);
  }, [tryCommitTypedText, inputText]);

  const handleClear = useCallback(() => {
    setOpen(false);
    commitTime(null);
  }, [commitTime]);

  return (
    <RadixPopover.Root open={open} onOpenChange={(next) => (next ? openList() : setOpen(false))}>
      <RadixPopover.Anchor asChild>
        <div className={cn("relative flex items-center", className)}>
          <input
            ref={inputRef}
            id={id}
            data-testid="time-picker"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={highlighted ? optionElementId(highlighted) : undefined}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-label={ariaLabel}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder={placeholder}
            value={inputText}
            onFocus={openList}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className={cn(triggerClassName, "pr-[var(--space-7)]")}
          />
          <div className="absolute right-[var(--space-1)] flex items-center gap-[var(--space-1)]">
            {clearable && value ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Clear time"
                disabled={disabled}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleClear();
                }}
                className={cn(
                  "flex flex-none items-center text-[var(--color-text-faint)] hover:text-[var(--color-text)]",
                  disabledState,
                )}
              >
                <X size={14} weight="bold" aria-hidden="true" />
              </button>
            ) : null}
            <Clock size={16} weight="bold" aria-hidden="true" className="flex-none text-[var(--color-text-muted)]" />
          </div>
        </div>
      </RadixPopover.Anchor>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          avoidCollisions
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "z-50 overflow-hidden",
            "border border-[var(--color-border)] bg-[var(--color-surface-raised)]",
            "shadow-[var(--shadow-md)]",
            "w-[var(--radix-popover-trigger-width)]",
            "max-h-[min(240px,var(--radix-popover-content-available-height))] overflow-y-auto",
            "p-[var(--space-1)]",
          )}
        >
          <div id={listboxId} role="listbox" aria-label={ariaLabel ?? placeholder}>
            {visibleOptions.map((time) => {
              const isDisabledOption = isOptionDisabled(time);
              const isSelected = time === value;
              const isHighlighted = time === highlighted;
              return (
                <div
                  key={time}
                  id={optionElementId(time)}
                  ref={(el) => {
                    if (el) optionRefs.current.set(time, el);
                    else optionRefs.current.delete(time);
                  }}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isDisabledOption || undefined}
                  data-testid="time-picker-option"
                  data-time={time}
                  data-highlighted={isHighlighted}
                  data-disabled={isDisabledOption}
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseMove={() => {
                    if (!isDisabledOption) setHighlighted(time);
                  }}
                  onClick={() => {
                    if (!isDisabledOption) commitTime(time);
                  }}
                  className={optionClassName}
                >
                  <span className="flex w-[14px] flex-none items-center justify-center text-[var(--color-text-muted)]">
                    {isSelected ? <Check size={14} weight="bold" aria-hidden="true" /> : null}
                  </span>
                  <span className="truncate">{formatTimeLabel(time)}</span>
                </div>
              );
            })}
            {visibleOptions.length === 0 ? (
              <div
                data-testid="time-picker-empty"
                className="px-[var(--space-2)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-faint)]"
              >
                No matching times
              </div>
            ) : null}
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
