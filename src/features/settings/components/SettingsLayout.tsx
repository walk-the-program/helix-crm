/**
 * The frame and the row vocabulary every settings screen is built from.
 *
 * This is macOS System Settings drawn in the Helix brand: a list of sections
 * on the left, grouped under caption-sized labels, and a detail pane on the
 * right made of **grouped inset lists** — a square-cornered panel with a
 * hairline between rows, a label on the left and the control on the right,
 * and a small-capitals label sitting above the panel in the canvas.
 *
 * Why a left section list rather than a segmented control along the top: it is
 * the idiom the reference application uses, it keeps every section one click
 * away from every other, and it survives the 1024px floor. At 1024 the shell's
 * sidebar takes 240, the shell's own gutter takes 2 x 32, this nav takes 224
 * and the 24px gap leaves a 472px detail column — which is wider than the
 * System Settings pane at its own minimum window, and a grouped list of
 * label/control rows is exactly what fits there. 224 rather than 192 because
 * "Keyboard shortcuts" truncated at 192, which the first screenshot pass
 * caught.
 *
 * Nothing here adds a page gutter: `Shell`'s `<main>` already pays
 * --space-7 / --space-6, and a screen that pads itself again
 * draws a double margin.
 */
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { navigate } from "wouter/use-browser-location";
import { Card, CardGroupLabel, CardRow, PageHeader, SidebarSection } from "@/ui";
import { cn } from "@/ui/cn";
import { ICON_SIZE } from "@/ui/icons";
import { sectionsByGroup } from "@/features/settings/lib/sections";
import type { SettingsSection } from "@/features/settings/lib/sections";

/* -------------------------------------------------------------------------- */
/* The section list                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every section, in its group, so the index is never the only way in.
 *
 * It lists the two rows other features own as well ("/pipeline" and "/trash"):
 * from the owner's side they are settings, and a list that hides them makes him
 * go back to the index to find them.
 *
 * **Why these rows are not `NavItem`.** `NavItem` paints its selected row in
 * the brand primary, and it says so in its own docstring: the shell's sidebar
 * is where the application spends its one confident block. This list sits
 * beside that sidebar, so a second `NavItem` would put two blocks of the
 * primary on one screen and a third beside the screen's primary button — which the
 * first screenshot pass caught immediately. The geometry is `NavItem`'s (same
 * height, same gutter, same 18px glyph taking the row's ink); the selected row
 * is the quiet `--color-selected` tint with full ink and weight 500, which is
 * what a selected row that is not the sidebar gets.
 */
function SettingsNavRow(props: { section: SettingsSection; active: boolean }) {
  const { section, active } = props;

  return (
    <div data-testid="settings-nav-link" data-section={section.id}>
      <a
        href={section.to}
        aria-current={active ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          navigate(section.to);
        }}
        className={cn(
          "flex min-h-[var(--control-h)] w-full items-center gap-[var(--space-2)]",
          "px-[var(--space-3)] no-underline hover:no-underline",
          "text-[length:var(--text-base)] text-[var(--color-text-muted)]",
          "hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]",
          "transition-colors duration-[var(--dur-fast)] motion-reduce:transition-none",
          "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]",
          "focus-visible:-outline-offset-2",
          active && "bg-[var(--color-selected)] font-medium text-[var(--color-text)]",
        )}
      >
        <span
          className="inline-flex flex-none items-center justify-center text-current"
          aria-hidden="true"
        >
          <section.icon size={ICON_SIZE} aria-hidden />
        </span>
        <span className="flex-1 truncate text-left" title={section.title}>
          {section.title}
        </span>
      </a>
    </div>
  );
}

export function SettingsNav() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Settings sections"
      data-testid="settings-nav"
      className="w-56 flex-none"
    >
      {sectionsByGroup().map((group) => (
        <SidebarSection key={group.id} label={group.label}>
          {group.sections.map((section) => (
            <SettingsNavRow
              key={section.id}
              section={section}
              active={location === section.to}
            />
          ))}
        </SidebarSection>
      ))}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* The frame                                                                  */
/* -------------------------------------------------------------------------- */

export function SettingsScreenFrame(props: {
  title: string;
  subtitle?: ReactNode;
  /**
   * At most one, and it is the screen's only primary button - the single
   * block of brand primary the guide allows per view. A screen with nothing
   * to do passes none.
   */
  actions?: ReactNode;
  children: ReactNode;
  /** Set on the outermost element so the e2e suite can find the screen. */
  testId: string;
}) {
  const { title, subtitle, actions, children, testId } = props;

  return (
    <div className="flex gap-[var(--space-6)]" data-testid={testId}>
      <SettingsNav />
      {/* The detail column. Capped so a row's label and its control stay in
          conversation on a wide window instead of drifting to opposite edges —
          the thing that makes a settings pane read as a web form. */}
      <div className="min-w-0 flex-1 max-w-3xl">
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        <div className="flex flex-col gap-[var(--space-6)]">{children}</div>
      </div>
    </div>
  );
}

/**
 * The same frame around a screen another feature built and this one mounts
 * under "/settings" (the website connection and backups).
 *
 * Without it, following the section list into one of those two screens loses
 * the section list, and the only way back is the shell's own sidebar - which
 * makes the sub-navigation a one-way door. The mounted screen brings its own
 * page header; all this adds is the list beside it and the same column cap.
 */
export function SettingsMount(props: { children: ReactNode }) {
  return (
    <div className="flex gap-[var(--space-6)]">
      <SettingsNav />
      <div className="min-w-0 flex-1 max-w-3xl">{props.children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The grouped inset list                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One grouped inset list: the small-capitals label in the canvas, the white
 * panel under it, and an optional sentence under the panel.
 *
 * The sentence goes *below* the group, not above the first row, because that is
 * where System Settings puts the explanation of a switch — and it keeps the
 * panel itself nothing but rows.
 */
export function SettingsGroup(props: {
  label?: string;
  footnote?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const { label, footnote, children, className } = props;

  return (
    <section className={cn("flex flex-col", className)} data-testid={props["data-testid"]}>
      {label ? <CardGroupLabel>{label}</CardGroupLabel> : null}
      <Card className="overflow-hidden">{children}</Card>
      {footnote ? (
        <p className="px-[var(--space-1)] pt-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
          {footnote}
        </p>
      ) : null}
    </section>
  );
}

/**
 * A row with a label on the left and a control on the right.
 *
 * `hint` is the second line under the label — the sample value, or the sentence
 * that says what the option does. It is --text-sm in secondary ink, so the
 * label keeps the row's weight.
 *
 * `field` boxes the control at a fixed width so that a column of selects and
 * inputs lines up down the panel. Without it the right side is only as wide as
 * what it holds, which is what a switch, a badge or a button cluster wants.
 */
export function SettingsRow(props: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  field?: boolean;
  /**
   * A glyph at the head of the row. It sits outside the label column rather
   * than inside it, so the hint under the label lines up with the label and not
   * with the icon - the misalignment the first screenshot pass caught on the
   * settings index.
   */
  leading?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Forwarded so a test or a screenshot can address one row. */
  "data-testid"?: string;
}) {
  const { label, hint, htmlFor, field, leading, children, className } = props;
  const labelClass = "text-[length:var(--text-base)] text-[var(--color-text)]";

  return (
    <CardRow
      className={cn("items-center gap-[var(--space-3)]", className)}
      data-testid={props["data-testid"]}
    >
      {leading ? (
        <span className="flex flex-none items-center text-[var(--color-text-muted)]">
          {leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)] py-[var(--space-1)]">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={labelClass}>
            {label}
          </label>
        ) : (
          <span className={labelClass}>{label}</span>
        )}
        {hint ? (
          <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {hint}
          </span>
        ) : null}
      </span>
      {children ? (
        <span
          className={cn(
            "flex flex-none items-center justify-end gap-[var(--space-2)]",
            field && "w-56 max-w-[55%]",
          )}
        >
          {children}
        </span>
      ) : null}
    </CardRow>
  );
}

/**
 * One choice in a grouped list of choices: the radio on the left, its name, and
 * the sentence that says what it does under the name.
 *
 * The radio itself is the native control, painted in ink rather than in an
 * accent — a chosen option is not asking for the owner's attention, and the
 * screen's one block of primary is already spent on its primary button — and
 * it stays a real `<input type="radio">` inside a `<label>`, so arrow keys
 * walk the group and a screen reader reads it without any help from us.
 */
export function SettingsChoiceRow(props: {
  /** The radio group's name: the same string on every row of one group. */
  name: string;
  value: string;
  checked: boolean;
  label: string;
  description?: string;
  onSelect: () => void;
  testId?: string;
}) {
  const { name, value, checked, label, description, onSelect, testId } = props;

  return (
    // The hairline lives on this wrapper rather than on the row inside it: the
    // wrapper is the panel's own child, so `last:border-b-0` resolves against
    // the panel. On the row it would resolve against the wrapper, where every
    // row is an only child and every hairline would disappear.
    <label
      className={cn(
        "block cursor-pointer hover:bg-[var(--color-hover)]",
        "border-b border-[var(--color-border)] last:border-b-0",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--color-focus)]",
        "has-[:focus-visible]:-outline-offset-2",
      )}
    >
      <CardRow className="items-start gap-[var(--space-3)] border-b-0 py-[var(--space-3)]">
        <span className="flex min-w-0 items-start gap-[var(--space-3)]">
          <input
            type="radio"
            name={name}
            value={value}
            checked={checked}
            onChange={onSelect}
            data-testid={testId}
            className="mt-[var(--space-1)] h-[var(--space-4)] w-[var(--space-4)] flex-none accent-[var(--color-text)]"
          />
          <span className="flex min-w-0 flex-col gap-[var(--space-1)]">
            <span
              className={cn(
                "text-[length:var(--text-base)] text-[var(--color-text)]",
                checked && "font-medium",
              )}
            >
              {label}
            </span>
            {description ? (
              <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                {description}
              </span>
            ) : null}
          </span>
        </span>
      </CardRow>
    </label>
  );
}

/**
 * A read-only label/value row: Diagnostics, and the "what gets sent" list on
 * the AI screen.
 *
 * The label column is fixed so the values line up down the panel, and the row
 * aligns to the top rather than the middle, because a file path or a sentence
 * wraps and a centred wrapped value pulls its label off the first line.
 */
export function SettingsValueRow(props: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <CardRow className={cn("items-start gap-[var(--space-4)] py-[var(--space-3)]", props.className)}>
      <span className="w-40 flex-none text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {props.label}
      </span>
      <span className="min-w-0 flex-1 text-left text-[length:var(--text-base)] text-[var(--color-text)]">
        {props.children}
      </span>
    </CardRow>
  );
}

/**
 * The one line a screen shows while it reads the database or helix.json.
 *
 * A sentence, not a spinner: an animated ring on an otherwise empty pane reads
 * as a screen that has broken. The e2e screenshot pass also waits on
 * `p[role="status"]` starting with "Reading", so every screen says it the same
 * way.
 */
export function SettingsLoading(props: { children: string }) {
  return (
    <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]" role="status">
      {props.children}
    </p>
  );
}

/**
 * Something the owner has to know before he acts — a switch that is refused
 * while a write holds the lock, a duplicate he is about to create.
 *
 * A muted tint and its own ink, which is the only tint the product allows for
 * attention. Square corners, flat fill, no border: it is a note, not a card,
 * and it sits inside the panel wherever there is a panel to put it in so it
 * never becomes a floating coloured box.
 */
export function SettingsNotice(props: {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <p
      role="status"
      data-testid={props["data-testid"]}
      className={cn(
        "bg-[var(--color-warning-soft)]",
        "px-[var(--space-3)] py-[var(--space-2)]",
        "text-[length:var(--text-sm)] text-[var(--color-warning-ink)]",
        props.className,
      )}
    >
      {props.children}
    </p>
  );
}
