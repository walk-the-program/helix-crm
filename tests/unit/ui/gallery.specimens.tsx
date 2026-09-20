/**
 * Specimen data and static-HTML renderer for the Helix CRM component gallery
 * (design/ui-screens/gallery.html). Every primitive exported from src/ui is
 * mounted with react-dom/client, its markup captured, and assembled into one
 * offline HTML document alongside gallery.css (see gallery.test.ts).
 *
 * This module only runs under jsdom (`createRoot` needs `document`), so it is
 * imported and invoked exclusively from gallery.test.ts, which carries the
 * `// @vitest-environment jsdom` docblock.
 */
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { CheckCircle2, Inbox, Phone, Plus, Search, Settings, Trash2 } from "@/ui/icons";

import {
  Badge,
  Brand,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  NavItem,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  type SelectOption,
  Sidebar,
  SidebarSection,
  Spinner,
  Switch,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  TimePicker,
  Tooltip,
  TooltipProvider,
  Topbar,
  VirtualList,
} from "@/ui";

/**
 * The edge-case company name DESIGN.md (section 4) calls out by name: 47
 * characters, the reason names truncate with an ellipsis and a `title`
 * instead of wrapping or shrinking.
 */
export const LONG_LABEL = "Little Cottonwood Canyon Homeowners Association";
if (LONG_LABEL.length !== 47) {
  throw new Error(`LONG_LABEL must be 47 characters, is ${LONG_LABEL.length}`);
}

type Specimen = {
  id: string;
  label: string;
  html: string;
  /** Rendered from an open Radix overlay: needs the position-neutralising chrome CSS. */
  overlay?: boolean;
  /** Dialog only: its content sets a percentage width meant for `position:
   * fixed` against the viewport. Once neutralised to `static`, that percentage
   * has nothing definite to resolve against and needs an explicit container. */
  wide?: boolean;
};

type Section = {
  id: string;
  title: string;
  specimens: Specimen[];
};

/** Overlays this pass could not force open in jsdom; reported, never faked. */
const skippedOverlays: string[] = [];

// ---------------------------------------------------------------------------
// jsdom stubs. Radix (ResizeObserver, pointer capture, scrollIntoView,
// matchMedia) and @tanstack/react-virtual (real element sizes) both need
// browser behaviour jsdom does not implement.
// ---------------------------------------------------------------------------
let stubsInstalled = false;
function ensureJsdomStubs(): void {
  if (stubsInstalled) return;
  stubsInstalled = true;
  const g = globalThis as unknown as { ResizeObserver?: unknown };

  if (typeof g.ResizeObserver === "undefined") {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }

  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }

  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }

  const proto = Element.prototype as unknown as {
    hasPointerCapture?: unknown;
    setPointerCapture?: unknown;
    releasePointerCapture?: unknown;
  };
  if (typeof proto.hasPointerCapture !== "function") {
    proto.hasPointerCapture = () => false;
  }
  if (typeof proto.setPointerCapture !== "function") {
    proto.setPointerCapture = () => {};
  }
  if (typeof proto.releasePointerCapture !== "function") {
    proto.releasePointerCapture = () => {};
  }

  // jsdom never computes real layout: every box is 0x0. @tanstack/react-virtual
  // (VirtualList) reads offsetHeight — both for the scroll viewport AND, via
  // measureElement, for each row — to decide which rows are "visible" and how
  // far to translateY each one. Those computed offsets get baked into the
  // static markup this module captures, so the value here becomes the row
  // height react-virtual bakes into the gallery's frozen snapshot: it must
  // match the list's own `estimateSize` (40, see buildVirtualListSection) or
  // rows render 15x further apart than intended once the real browser paints
  // the (now-static) transform values. Radix's floating-ui positioning also
  // reads these, but the gallery neutralises overlay positioning with its own
  // CSS regardless (see .specimen-overlay), so a small value is safe there too.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: 40,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 40,
  });
}

// ---------------------------------------------------------------------------
// Mounting helpers
// ---------------------------------------------------------------------------

/** Mounts a specimen into a detached, then-removed container and returns its markup. */
function mount(node: ReactNode): string {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(node);
  });
  const html = container.innerHTML;
  flushSync(() => {
    root.unmount();
  });
  container.remove();
  return html;
}

/**
 * Mounts an overlay specimen, optionally running `interact` (a synthetic
 * click/focus) to force it open, then harvests whatever Radix portalled onto
 * document.body — cleaning the body afterwards so specimens never bleed into
 * each other.
 */
function mountOverlay(node: ReactNode, interact?: (container: HTMLElement) => void): string {
  const before = new Set(Array.from(document.body.children));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(node);
  });
  if (interact) {
    interact(container);
  }
  // The trigger (Tooltip's IconButton, Select's/DropdownMenu's/Popover's
  // Trigger) stays in `container`; only the Content portals onto
  // document.body. Capture both, or the gallery shows a floating menu/tooltip
  // with nothing to anchor it to.
  const triggerHtml = container.innerHTML;
  const portalNodes = Array.from(document.body.children).filter(
    (el) => el !== container && !before.has(el),
  );
  const portalHtml = portalNodes.map((el) => el.outerHTML).join("\n");
  flushSync(() => {
    root.unmount();
  });
  container.remove();
  portalNodes.forEach((el) => el.remove());
  const html = [triggerHtml, portalHtml].filter((part) => part.trim().length > 0).join("\n");
  return html;
}

/** A synthetic click, used to open Select without a real pointer. */
function click(el: Element): void {
  flushSync(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** A synthetic keyboard focus, which opens Radix Tooltip with no hover delay. */
function focus(el: HTMLElement): void {
  flushSync(() => {
    el.focus();
  });
}

// ---------------------------------------------------------------------------
// State-demo wrappers. Real :hover / :focus-visible cannot survive being
// serialised to a static string, so instead of re-rendering, we wrap the
// SAME default markup in a marker div that the gallery's own chrome CSS
// paints — the identical token the component's own hover: class would apply.
// ---------------------------------------------------------------------------

function withHoverDemo(html: string, hoverToken: string): string {
  return `<div class="demo-hover" style="--demo-bg: var(${hoverToken})">${html}</div>`;
}

function withFocusDemo(html: string): string {
  return `<div class="demo-focus">${html}</div>`;
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
const BUTTON_SIZES = ["sm", "md", "lg"] as const;
const BUTTON_HOVER_TOKEN: Record<(typeof BUTTON_VARIANTS)[number], string> = {
  primary: "--color-accent-hover",
  secondary: "--color-hover",
  ghost: "--color-hover",
  danger: "--color-danger-soft",
};
const BUTTON_LABEL: Record<(typeof BUTTON_VARIANTS)[number], string> = {
  primary: "Save changes",
  secondary: "Import contacts",
  ghost: "Log a call",
  danger: "Delete contact",
};

function buildButtonSection(): Section {
  const specimens: Specimen[] = [];
  for (const variant of BUTTON_VARIANTS) {
    for (const size of BUTTON_SIZES) {
      const base = `button.${variant}.${size}`;
      const label = BUTTON_LABEL[variant];
      const defaultHtml = mount(
        <Button variant={variant} size={size}>
          {label}
        </Button>,
      );
      specimens.push({ id: `${base}.default`, label: "Default", html: defaultHtml });
      specimens.push({
        id: `${base}.hover`,
        label: "Hover",
        html: withHoverDemo(defaultHtml, BUTTON_HOVER_TOKEN[variant]),
      });
      specimens.push({
        id: `${base}.focus-visible`,
        label: "Focus-visible",
        html: withFocusDemo(defaultHtml),
      });
      specimens.push({
        id: `${base}.disabled`,
        label: "Disabled",
        html: mount(
          <Button variant={variant} size={size} disabled>
            {label}
          </Button>,
        ),
      });
      specimens.push({
        id: `${base}.loading`,
        label: "Loading",
        html: mount(
          <Button variant={variant} size={size} loading loadingLabel="Saving…">
            {label}
          </Button>,
        ),
      });
      specimens.push({
        id: `${base}.icon`,
        label: "With icon",
        html: mount(
          <Button
            variant={variant}
            size={size}
            iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
          >
            {label}
          </Button>,
        ),
      });
      specimens.push({
        id: `${base}.long-label`,
        label: "Long label",
        html: mount(
          <Button variant={variant} size={size}>
            {LONG_LABEL}
          </Button>,
        ),
      });
    }
  }
  return { id: "button", title: "Button", specimens };
}

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

const ICON_BUTTON_VARIANTS = ["ghost", "secondary", "danger"] as const;
const ICON_BUTTON_SIZES = ["sm", "md"] as const;
const ICON_BUTTON_HOVER_TOKEN: Record<(typeof ICON_BUTTON_VARIANTS)[number], string> = {
  ghost: "--color-hover",
  secondary: "--color-hover",
  danger: "--color-danger-soft",
};

function buildIconButtonSection(): Section {
  const specimens: Specimen[] = [];
  for (const variant of ICON_BUTTON_VARIANTS) {
    for (const size of ICON_BUTTON_SIZES) {
      const base = `iconbutton.${variant}.${size}`;
      const isDanger = variant === "danger";
      const label = isDanger ? "Delete contact" : "Settings";
      const icon = isDanger ? (
        <Trash2 size={16} weight="bold" aria-hidden="true" />
      ) : (
        <Settings size={16} weight="bold" aria-hidden="true" />
      );
      const defaultHtml = mount(
        <IconButton variant={variant} size={size} label={label} icon={icon} />,
      );
      specimens.push({ id: `${base}.default`, label: "Default", html: defaultHtml });
      specimens.push({
        id: `${base}.hover`,
        label: "Hover",
        html: withHoverDemo(defaultHtml, ICON_BUTTON_HOVER_TOKEN[variant]),
      });
      specimens.push({
        id: `${base}.focus-visible`,
        label: "Focus-visible",
        html: withFocusDemo(defaultHtml),
      });
      specimens.push({
        id: `${base}.disabled`,
        label: "Disabled",
        html: mount(<IconButton variant={variant} size={size} label={label} icon={icon} disabled />),
      });
    }
  }
  return { id: "iconbutton", title: "IconButton", specimens };
}

// ---------------------------------------------------------------------------
// Input / Textarea
// ---------------------------------------------------------------------------

function buildInputSection(): Section {
  const specimens: Specimen[] = [];
  const defaultHtml = mount(<Input placeholder="(801) 555-0147" readOnly />);
  specimens.push({ id: "input.default", label: "Default", html: defaultHtml });
  specimens.push({ id: "input.focus-visible", label: "Focus-visible", html: withFocusDemo(defaultHtml) });
  specimens.push({
    id: "input.disabled",
    label: "Disabled",
    html: mount(<Input disabled defaultValue="(801) 555-0147" readOnly />),
  });
  specimens.push({
    id: "input.error",
    label: "Error",
    html: mount(<Input invalid defaultValue="801555" readOnly />),
  });
  specimens.push({
    id: "input.long-value",
    label: "Long value",
    html: mount(<Input defaultValue={LONG_LABEL} readOnly />),
  });
  return { id: "input", title: "Input", specimens };
}

function buildTextareaSection(): Section {
  const specimens: Specimen[] = [];
  const defaultHtml = mount(<Textarea placeholder="Notes from the last call…" readOnly />);
  specimens.push({ id: "textarea.default", label: "Default", html: defaultHtml });
  specimens.push({
    id: "textarea.focus-visible",
    label: "Focus-visible",
    html: withFocusDemo(defaultHtml),
  });
  specimens.push({
    id: "textarea.disabled",
    label: "Disabled",
    html: mount(<Textarea disabled defaultValue="Notes are locked." readOnly />),
  });
  specimens.push({
    id: "textarea.error",
    label: "Error",
    html: mount(<Textarea invalid defaultValue="" readOnly />),
  });
  specimens.push({
    id: "textarea.long-value",
    label: "Long value",
    html: mount(
      <Textarea
        defaultValue={`${LONG_LABEL} called back and asked for a quote on the retaining wall.`}
        readOnly
      />,
    ),
  });
  return { id: "textarea", title: "Textarea", specimens };
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

const SELECT_OPTIONS: SelectOption[] = [
  { value: "new", label: "New lead" },
  { value: "contacted", label: "Contacted" },
  { value: "estimate", label: "Estimate sent" },
  { value: "scheduled", label: "Scheduled" },
  { value: "won", label: "Won" },
];

function buildSelectSection(): Section {
  const specimens: Specimen[] = [];
  const defaultHtml = mount(
    <Select value="estimate" onValueChange={() => {}} options={SELECT_OPTIONS} ariaLabel="Stage" />,
  );
  specimens.push({ id: "select.default", label: "Default", html: defaultHtml });
  specimens.push({ id: "select.focus-visible", label: "Focus-visible", html: withFocusDemo(defaultHtml) });
  specimens.push({
    id: "select.disabled",
    label: "Disabled",
    html: mount(
      <Select
        value="estimate"
        onValueChange={() => {}}
        options={SELECT_OPTIONS}
        disabled
        ariaLabel="Stage"
      />,
    ),
  });
  specimens.push({
    id: "select.error",
    label: "Error",
    html: mount(
      <Select
        value={undefined}
        onValueChange={() => {}}
        options={SELECT_OPTIONS}
        invalid
        placeholder="Choose a stage"
        ariaLabel="Stage"
      />,
    ),
  });

  const openHtml = mountOverlay(
    <Select value="estimate" onValueChange={() => {}} options={SELECT_OPTIONS} ariaLabel="Stage" />,
    (container) => {
      const trigger = container.querySelector<HTMLElement>("button");
      if (trigger) click(trigger);
    },
  );
  if (openHtml.trim()) {
    specimens.push({ id: "select.open", label: "Open menu", html: openHtml, overlay: true });
  } else {
    skippedOverlays.push("Select (open menu)");
  }

  return { id: "select", title: "Select", specimens };
}

// ---------------------------------------------------------------------------
// Checkbox / Switch
// ---------------------------------------------------------------------------

function buildCheckboxSection(): Section {
  const specimens: Specimen[] = [];
  const unchecked = mount(<Checkbox checked={false} onCheckedChange={() => {}} ariaLabel="Select row" />);
  specimens.push({ id: "checkbox.unchecked", label: "Unchecked", html: unchecked });
  specimens.push({
    id: "checkbox.focus-visible",
    label: "Focus-visible",
    html: withFocusDemo(unchecked),
  });
  specimens.push({
    id: "checkbox.checked",
    label: "Checked",
    html: mount(<Checkbox checked={true} onCheckedChange={() => {}} ariaLabel="Select row" />),
  });
  specimens.push({
    id: "checkbox.indeterminate",
    label: "Indeterminate",
    html: mount(
      <Checkbox checked="indeterminate" onCheckedChange={() => {}} ariaLabel="Select all rows" />,
    ),
  });
  specimens.push({
    id: "checkbox.disabled",
    label: "Disabled",
    html: mount(<Checkbox checked={false} onCheckedChange={() => {}} disabled ariaLabel="Select row" />),
  });
  specimens.push({
    id: "checkbox.tone-success",
    label: "Tone success (checked)",
    html: mount(
      <Checkbox checked={true} onCheckedChange={() => {}} tone="success" ariaLabel="Task complete" />,
    ),
  });
  return { id: "checkbox", title: "Checkbox", specimens };
}

function buildSwitchSection(): Section {
  const specimens: Specimen[] = [];
  const off = mount(<Switch checked={false} onCheckedChange={() => {}} ariaLabel="Email notifications" />);
  specimens.push({ id: "switch.off", label: "Off", html: off });
  specimens.push({ id: "switch.focus-visible", label: "Focus-visible", html: withFocusDemo(off) });
  specimens.push({
    id: "switch.on",
    label: "On",
    html: mount(<Switch checked={true} onCheckedChange={() => {}} ariaLabel="Email notifications" />),
  });
  specimens.push({
    id: "switch.disabled",
    label: "Disabled",
    html: mount(
      <Switch checked={false} onCheckedChange={() => {}} disabled ariaLabel="Email notifications" />,
    ),
  });
  return { id: "switch", title: "Switch", specimens };
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function buildBadgeSection(): Section {
  const specimens: Specimen[] = [];
  specimens.push({ id: "badge.neutral", label: "Neutral", html: mount(<Badge tone="neutral">Draft</Badge>) });
  specimens.push({
    id: "badge.accent",
    label: "Accent",
    html: mount(<Badge tone="accent">Needs you</Badge>),
  });
  specimens.push({ id: "badge.success", label: "Success", html: mount(<Badge tone="success">Won</Badge>) });
  specimens.push({
    id: "badge.warning",
    label: "Warning",
    html: mount(<Badge tone="warning">Offline</Badge>),
  });
  specimens.push({
    id: "badge.danger",
    label: "Danger",
    html: mount(<Badge tone="danger">Overdue</Badge>),
  });
  specimens.push({
    id: "badge.stage-dot",
    label: "Stage badge (dot)",
    html: mount(
      <Badge dotColor="var(--stage-3)">Estimate sent</Badge>,
    ),
  });
  specimens.push({
    id: "badge.pill",
    label: "Count pill, needs you",
    html: mount(
      <Badge tone="accent" pill solid>
        12
      </Badge>,
    ),
  });
  specimens.push({
    id: "badge.pill-neutral",
    label: "Count pill, ordinary",
    html: mount(
      <Badge tone="neutral" pill solid>
        1,204
      </Badge>,
    ),
  });
  specimens.push({
    id: "badge.long-label",
    label: "Long label",
    html: mount(<Badge tone="neutral">{LONG_LABEL}</Badge>),
  });
  return { id: "badge", title: "Badge", specimens };
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function buildCardSection(): Section {
  const specimens: Specimen[] = [];
  specimens.push({
    id: "card.basic",
    label: "Basic",
    html: mount(
      <Card style={{ width: 260, padding: "var(--space-4)" }}>Kitchen remodel — $12,450.00</Card>,
    ),
  });
  specimens.push({
    id: "card.full",
    label: "Header, body, footer",
    html: mount(
      <Card style={{ width: 320 }}>
        <CardHeader>
          <CardTitle>Estimate sent</CardTitle>
          <Badge tone="neutral">4 deals</Badge>
        </CardHeader>
        <CardBody>Kitchen remodel — Brent Hendrickson, $12,450.00</CardBody>
        <CardFooter>
          <Button variant="ghost" size="sm">
            View
          </Button>
          <Button variant="secondary" size="sm">
            Edit
          </Button>
        </CardFooter>
      </Card>,
    ),
  });
  specimens.push({
    id: "card.attention",
    label: "Attention rail",
    html: mount(
      <Card attention style={{ width: 260, padding: "var(--space-4)" }}>
        No next step — call Brent back
      </Card>,
    ),
  });
  return { id: "card", title: "Card", specimens };
}

// ---------------------------------------------------------------------------
// Grouped inset list — Card + rows separated by hairlines. The macOS
// "grouped table view" pattern: a Card containing plain rows, each divided
// from the next by a single --color-border hairline rather than its own
// border, card padding, or a shadow. Added for the native-minimalist pass
// (docs/DESIGN.md); no dedicated component exists yet, so this specimen is
// built from Card plus token-driven row styling, the same way every other
// composite specimen in this file is.
// ---------------------------------------------------------------------------

const GROUPED_LIST_ROWS: Array<{ label: string; value: ReactNode }> = [
  { label: "Stage", value: <Badge tone="accent">Estimate sent</Badge> },
  { label: "Owner", value: "Dana Whitfield" },
  { label: "Source", value: "Website form" },
  { label: "Last activity", value: "2 days ago" },
];

function buildGroupedListSection(): Section {
  const specimens: Specimen[] = [];
  specimens.push({
    id: "groupedlist.inset",
    label: "Grouped inset list",
    html: mount(
      <Card style={{ width: 320 }}>
        {GROUPED_LIST_ROWS.map((row, index) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-3)",
              padding: "var(--space-3) var(--space-4)",
              borderBottom:
                index < GROUPED_LIST_ROWS.length - 1 ? "1px solid var(--color-border)" : undefined,
              fontSize: "var(--text-base)",
            }}
          >
            <span style={{ color: "var(--color-text-muted)" }}>{row.label}</span>
            <span>{row.value}</span>
          </div>
        ))}
      </Card>,
    ),
  });
  return { id: "groupedlist", title: "Grouped inset list", specimens };
}

// ---------------------------------------------------------------------------
// Section label row — the 11px uppercase, tracked, tertiary-ink label a
// native sidebar or grouped list uses to name a cluster of rows (the same
// treatment SidebarSection applies to its own `label` prop). Rendered here
// from the raw tokens rather than an internal class fragment, since
// src/ui/styles.ts is deliberately not re-exported from src/ui/index.ts.
// ---------------------------------------------------------------------------

function buildSectionLabelSection(): Section {
  const specimens: Specimen[] = [
    {
      id: "sectionlabel.default",
      label: "Section label",
      html: mount(
        <div
          style={{
            fontSize: "var(--text-label)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-label)",
            color: "var(--color-text-faint)",
          }}
        >
          Pinned views
        </div>,
      ),
    },
  ];
  return { id: "sectionlabel", title: "Section label", specimens };
}

// ---------------------------------------------------------------------------
// Badge — every tone together, muted pastel
// ---------------------------------------------------------------------------

const BADGE_ALL_TONES: Array<{
  tone: "neutral" | "accent" | "brand" | "secondary" | "highlight" | "success" | "warning" | "danger";
  label: string;
}> = [
  { tone: "neutral", label: "Draft" },
  { tone: "accent", label: "Needs you" },
  { tone: "brand", label: "Primary tint" },
  { tone: "secondary", label: "Secondary tint" },
  { tone: "highlight", label: "Accent tint" },
  { tone: "success", label: "Won" },
  { tone: "warning", label: "Offline" },
  { tone: "danger", label: "Overdue" },
];

function buildBadgeAllTonesSection(): Section {
  const specimens: Specimen[] = [
    {
      id: "badge.tones-all",
      label: "All tones, muted pastel",
      html: mount(
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {BADGE_ALL_TONES.map(({ tone, label }) => (
            <Badge key={tone} tone={tone}>
              {label}
            </Badge>
          ))}
        </div>,
      ),
    },
  ];
  return { id: "badgetones", title: "Badge — all tones", specimens };
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function buildEmptyStateSection(): Section {
  const specimens: Specimen[] = [];
  specimens.push({
    id: "emptystate.empty-list",
    label: "Empty list",
    html: mount(
      <EmptyState
        icon={<Inbox size={18} weight="regular" aria-hidden="true" />}
        title="No leads waiting"
        description="New leads from your website and calls will show up here."
        action={<Button variant="primary">Add a lead</Button>}
      />,
    ),
  });
  specimens.push({
    id: "emptystate.zero-result",
    label: "Zero-result search",
    html: mount(
      <EmptyState
        icon={<Search size={18} weight="regular" aria-hidden="true" />}
        title={"No results for \u201ccottonwood\u201d"}
        description={
          <>
            Nothing matches &ldquo;cottonwood&rdquo;. Clear the filters, or create a
            contact named &ldquo;cottonwood&rdquo;.
          </>
        }
        action={
          <>
            <Button variant="secondary">Clear filters</Button>
            <Button variant="ghost">Create &ldquo;cottonwood&rdquo;</Button>
          </>
        }
      />,
    ),
  });
  specimens.push({
    id: "emptystate.cleared",
    label: "Cleared (reward)",
    html: mount(
      <EmptyState
        icon={
          <CheckCircle2
            size={18}
            weight="regular"
            className="text-[var(--color-success)]"
            aria-hidden="true"
          />
        }
        title="No overdue tasks"
        description="Everything is caught up."
      />,
    ),
  });
  return { id: "emptystate", title: "EmptyState", specimens };
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

function buildFieldSection(): Section {
  const specimens: Specimen[] = [];
  specimens.push({
    id: "field.hint",
    label: "With hint",
    html: mount(
      <Field label="Phone" hint="Include the area code.">
        <Input placeholder="(801) 555-0147" readOnly />
      </Field>,
    ),
  });
  specimens.push({
    id: "field.error",
    label: "With error",
    html: mount(
      <Field label="Phone" error="Enter a phone number with at least 10 digits.">
        <Input invalid defaultValue="801555" readOnly />
      </Field>,
    ),
  });
  specimens.push({
    id: "field.required",
    label: "Required",
    html: mount(
      <Field label="Company name" required>
        <Input placeholder="Acme Landscaping" readOnly />
      </Field>,
    ),
  });
  return { id: "field", title: "Field", specimens };
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const TABLE_ROWS: Array<{ name: string; stage: string; value: string; selected?: boolean }> = [
  { name: "Brent Hendrickson", stage: "Estimate sent", value: "$12,450.00", selected: true },
  { name: LONG_LABEL, stage: "Contacted", value: "$1,204.00" },
  { name: "Dana Whitfield", stage: "Scheduled", value: "$89,420.00" },
  { name: "Marcus Ibarra", stage: "New lead", value: "$3,900.00" },
  { name: "Priya Chandrasekaran", stage: "Won", value: "$24,000.00" },
];
// 12,450.00 + 1,204.00 + 89,420.00 + 3,900.00 + 24,000.00
const TABLE_TOTAL = "$130,974.00";

function buildTableSection(): Section {
  const specimens: Specimen[] = [];
  const tableHtml = mount(
    <Table style={{ width: 680 }}>
      <THead>
        <tr>
          <TH>Customer</TH>
          <TH sortable sortDirection="asc" onSort={() => {}}>
            Stage
          </TH>
          <TH sortable sortDirection={null} onSort={() => {}} align="right">
            Value
          </TH>
        </tr>
      </THead>
      <TBody>
        {TABLE_ROWS.map((row) => (
          <TR key={row.name} selected={row.selected}>
            <TD primary title={row.name}>
              {row.name}
            </TD>
            <TD muted>{row.stage}</TD>
            <TD align="right" className="money">
              {row.value}
            </TD>
          </TR>
        ))}
      </TBody>
      <TFoot>
        <tr>
          <TD>Total</TD>
          <TD>&nbsp;</TD>
          <TD align="right" className="money">
            {TABLE_TOTAL}
          </TD>
        </tr>
      </TFoot>
    </Table>,
  );
  specimens.push({ id: "table.full", label: "Full table", html: tableHtml });

  const sortHtml = mount(
    <table style={{ width: 360 }}>
      <THead>
        <tr>
          <TH sortable sortDirection="asc" onSort={() => {}}>
            Ascending
          </TH>
          <TH sortable sortDirection="desc" onSort={() => {}}>
            Descending
          </TH>
          <TH sortable sortDirection={null} onSort={() => {}}>
            Unsorted
          </TH>
        </tr>
      </THead>
    </table>,
  );
  specimens.push({ id: "table.sort-states", label: "Sortable header states", html: sortHtml });

  return { id: "table", title: "Table", specimens };
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function buildTabsSection(): Section {
  const specimens: Specimen[] = [];
  specimens.push({
    id: "tabs.default",
    label: "Default",
    html: mount(
      <Tabs defaultValue="overview" style={{ width: 340 }}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview content.</TabsContent>
      </Tabs>,
    ),
  });
  specimens.push({
    id: "tabs.disabled-tab",
    label: "With a disabled tab",
    html: mount(
      <Tabs defaultValue="overview" style={{ width: 340 }}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="billing" disabled>
            Billing
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview content.</TabsContent>
      </Tabs>,
    ),
  });
  return { id: "tabs", title: "Tabs", specimens };
}

// ---------------------------------------------------------------------------
// Kbd / Spinner / PageHeader
// ---------------------------------------------------------------------------

function buildKbdSection(): Section {
  const specimens: Specimen[] = [
    { id: "kbd.mod-k", label: "Quick add", html: mount(<Kbd keys="mod+k" />) },
    { id: "kbd.enter", label: "Confirm", html: mount(<Kbd keys="enter" />) },
    { id: "kbd.shift-enter", label: "New line", html: mount(<Kbd keys="shift+enter" />) },
  ];
  return { id: "kbd", title: "Kbd", specimens };
}

function buildSpinnerSection(): Section {
  const specimens: Specimen[] = [
    { id: "spinner.default", label: "Default", html: mount(<Spinner />) },
    { id: "spinner.small", label: "Small", html: mount(<Spinner size={16} />) },
    {
      id: "spinner.labeled",
      label: "With label",
      html: mount(<Spinner size={24} label="Importing 1,204 contacts" />),
    },
  ];
  return { id: "spinner", title: "Spinner", specimens };
}

function buildPageHeaderSection(): Section {
  const specimens: Specimen[] = [
    {
      id: "pageheader.default",
      label: "Default",
      html: mount(
        <PageHeader
          breadcrumb="Contacts"
          title="Brent Hendrickson"
          subtitle="Cottonwood Heights, UT"
          actions={<Button variant="primary">Log a call</Button>}
        />,
      ),
    },
    {
      id: "pageheader.long-title",
      label: "Long title",
      html: mount(<PageHeader title={LONG_LABEL} subtitle="Company" />),
    },
  ];
  return { id: "pageheader", title: "PageHeader", specimens };
}

// ---------------------------------------------------------------------------
// Sidebar / SidebarSection / NavItem / Topbar
// ---------------------------------------------------------------------------

function buildNavSection(): Section {
  const specimens: Specimen[] = [];
  specimens.push({
    id: "sidebar.full",
    label: "Sidebar (active + inactive items)",
    html: mount(
      <div style={{ height: 420 }}>
        <Sidebar>
          <SidebarSection>
            <NavItem label="Today" active onClick={() => {}} />
            <NavItem label="Contacts" onClick={() => {}} />
            <NavItem label="Companies" onClick={() => {}} />
            <NavItem label="Pipeline" onClick={() => {}} />
          </SidebarSection>
          <SidebarSection label="Pinned views">
            <NavItem label="Gone quiet" onClick={() => {}} />
          </SidebarSection>
        </Sidebar>
      </div>,
    ),
  });
  const navItemDefault = mount(<NavItem label="Companies" onClick={() => {}} />);
  specimens.push({ id: "navitem.hover", label: "NavItem hover", html: withHoverDemo(navItemDefault, "--color-hover") });
  specimens.push({
    id: "navitem.focus-visible",
    label: "NavItem focus-visible",
    html: withFocusDemo(navItemDefault),
  });
  specimens.push({
    id: "topbar.full",
    label: "Topbar",
    html: mount(
      <Topbar
        left={<strong>Pipeline</strong>}
        right={
          <>
            <IconButton
              label="Search"
              icon={<Search size={16} weight="bold" aria-hidden="true" />}
            />
            <Button variant="secondary" iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}>
              Quick add
            </Button>
          </>
        }
      />,
    ),
  });
  return { id: "nav", title: "Sidebar / Topbar", specimens };
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function buildDialogSection(): Section {
  const specimens: Specimen[] = [];

  const contentHtml = mountOverlay(
    <Dialog open>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Edit contact</DialogTitle>
          <DialogDescription>Update Brent Hendrickson&apos;s details.</DialogDescription>
        </DialogHeader>
        <Field label="Phone" required>
          <Input defaultValue="(801) 555-0147" readOnly />
        </Field>
        <DialogFooter>
          <Button variant="secondary">Cancel</Button>
          <Button variant="primary">Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
  if (contentHtml.trim()) {
    specimens.push({ id: "dialog.content", label: "Form dialog", html: contentHtml, overlay: true, wide: true });
  } else {
    skippedOverlays.push("Dialog (form content)");
  }

  const confirmHtml = mountOverlay(
    <ConfirmDialog
      open
      onOpenChange={() => {}}
      title="Delete Brent Hendrickson?"
      description="He moves to Trash and can be restored for 30 days."
      confirmLabel="Delete contact"
      destructive
      onConfirm={() => {}}
    />,
  );
  if (confirmHtml.trim()) {
    specimens.push({ id: "dialog.confirm", label: "Confirm dialog", html: confirmHtml, overlay: true, wide: true });
  } else {
    skippedOverlays.push("Dialog (confirm)");
  }

  return { id: "dialog", title: "Dialog", specimens };
}

// ---------------------------------------------------------------------------
// DropdownMenu
// ---------------------------------------------------------------------------

function buildDropdownMenuSection(): Section {
  const specimens: Specimen[] = [];
  const html = mountOverlay(
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Contact</DropdownMenuLabel>
        <DropdownMenuItem>Log a call</DropdownMenuItem>
        <DropdownMenuItem>Send email</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked>Pin to Today</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive>Delete contact</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  if (html.trim()) {
    specimens.push({ id: "dropdownmenu.content", label: "Open menu", html, overlay: true });
  } else {
    skippedOverlays.push("DropdownMenu (open content)");
  }
  return { id: "dropdownmenu", title: "DropdownMenu", specimens };
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

function buildPopoverSection(): Section {
  const specimens: Specimen[] = [];
  const html = mountOverlay(
    <Popover open>
      <PopoverTrigger asChild>
        <Button variant="secondary">Filter</Button>
      </PopoverTrigger>
      <PopoverContent>
        <Field label="Stage">
          <Select value="estimate" onValueChange={() => {}} options={SELECT_OPTIONS} ariaLabel="Stage" />
        </Field>
      </PopoverContent>
    </Popover>,
  );
  if (html.trim()) {
    specimens.push({ id: "popover.content", label: "Open popover", html, overlay: true });
  } else {
    skippedOverlays.push("Popover (open content)");
  }
  return { id: "popover", title: "Popover", specimens };
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function buildTooltipSection(): Section {
  const specimens: Specimen[] = [];
  const html = mountOverlay(
    <TooltipProvider>
      <Tooltip content="Log a call">
        <IconButton label="Log a call" icon={<Phone size={16} weight="bold" aria-hidden="true" />} />
      </Tooltip>
    </TooltipProvider>,
    (container) => {
      const trigger = container.querySelector<HTMLElement>("button");
      if (trigger) focus(trigger);
    },
  );
  if (html.trim()) {
    specimens.push({ id: "tooltip.content", label: "Open tooltip", html, overlay: true });
  } else {
    skippedOverlays.push("Tooltip (open content) — focus simulation did not open it in jsdom");
  }
  return { id: "tooltip", title: "Tooltip", specimens };
}

// ---------------------------------------------------------------------------
// VirtualList
// ---------------------------------------------------------------------------

function buildVirtualListSection(): Section {
  const items = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: `Activity row ${i + 1}` }));
  const listHtml = mount(
    <div style={{ height: 200, width: 320 }}>
      <VirtualList
        items={items}
        estimateSize={40}
        ariaLabel="Recent activity"
        className="h-full"
        renderRow={(item) => (
          <div
            style={{
              height: 40,
              display: "flex",
              alignItems: "center",
              padding: "0 var(--space-3)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            {item.name}
          </div>
        )}
      />
    </div>,
  );
  return {
    id: "virtuallist",
    title: "VirtualList",
    specimens: [{ id: "virtuallist.short", label: "Short list", html: listHtml }],
  };
}

// ---------------------------------------------------------------------------
// Brand lockup
// ---------------------------------------------------------------------------

function buildBrandSection(): Section {
  return {
    id: "brand",
    title: "Brand lockup",
    specimens: [
      {
        id: "brand.sm",
        label: "Lockup, sidebar size",
        html: mount(<Brand size="sm" />),
      },
      {
        id: "brand.lg",
        label: "Lockup, boot size",
        html: mount(<Brand size="lg" />),
      },
      {
        id: "brand.mark-only",
        label: "Mark only",
        html: mount(<Brand size="lg" wordmark={false} />),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Pickers: Combobox / DatePicker / TimePicker (round 3)
//
// The three primitives that replaced a long `Select` and the native
// `<input type="date|time">`. Each one is shown closed, which is what a form
// row actually looks like, and open, which is the part that had to stop
// running off the bottom of the screen.
// ---------------------------------------------------------------------------

const PICKER_CONTACTS = [
  { id: "c1", label: "Aisha Okafor", detail: "Okafor Roofing" },
  { id: "c2", label: "Ben Whitcombe", detail: "Whitcombe & Sons" },
  { id: "c3", label: LONG_LABEL },
];

function buildPickerSection(): Section {
  const specimens: Specimen[] = [];

  specimens.push({
    id: "combobox.closed",
    label: "Combobox, nothing chosen",
    html: mount(<Combobox value={null} onChange={() => {}} items={PICKER_CONTACTS} placeholder="Search contacts" aria-label="Contact" />),
  });
  specimens.push({
    id: "combobox.chosen",
    label: "Combobox, a contact chosen",
    html: mount(<Combobox value="c1" onChange={() => {}} items={PICKER_CONTACTS} aria-label="Contact" />),
  });

  const comboOpen = mountOverlay(
    <Combobox value="c1" onChange={() => {}} items={PICKER_CONTACTS} aria-label="Contact" />,
    (container) => {
      const trigger = container.querySelector<HTMLElement>("[data-testid='combobox']");
      trigger?.click();
    },
  );
  if (comboOpen.trim()) {
    specimens.push({ id: "combobox.open", label: "Combobox, list open", html: comboOpen, overlay: true });
  } else {
    skippedOverlays.push("Combobox (open list)");
  }

  specimens.push({
    id: "datepicker.empty",
    label: "DatePicker, no date",
    html: mount(<DatePicker value={null} onChange={() => {}} aria-label="Due date" />),
  });
  specimens.push({
    id: "datepicker.chosen",
    label: "DatePicker, a date chosen",
    html: mount(<DatePicker value="2026-09-19" onChange={() => {}} aria-label="Due date" locale="en-GB" />),
  });

  const dateOpen = mountOverlay(
    <DatePicker value="2026-09-19" onChange={() => {}} aria-label="Due date" locale="en-GB" />,
    (container) => {
      const trigger = container.querySelector<HTMLElement>("[data-testid='date-picker']");
      trigger?.click();
    },
  );
  if (dateOpen.trim()) {
    specimens.push({ id: "datepicker.open", label: "DatePicker, calendar open", html: dateOpen, overlay: true });
  } else {
    skippedOverlays.push("DatePicker (open calendar)");
  }

  specimens.push({
    id: "timepicker.empty",
    label: "TimePicker, no time",
    html: mount(<TimePicker value={null} onChange={() => {}} aria-label="Start time" />),
  });
  specimens.push({
    id: "timepicker.chosen",
    label: "TimePicker, a time chosen",
    html: mount(<TimePicker value="09:30" onChange={() => {}} aria-label="Start time" />),
  });

  return { id: "pickers", title: "Pickers", specimens };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export const SPECIMEN_IDS: string[] = [];

const GALLERY_STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { min-width: 0; }
body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
}
.gallery-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.gallery-header h1 {
  margin: 0;
  font-size: var(--text-xl);
}
.gallery-header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.gallery-controls {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.gallery-controls button {
  font: inherit;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}
.gallery-controls button[aria-pressed="true"] {
  background: var(--color-selected);
  border-color: var(--color-border-strong);
  font-weight: 600;
}
.gallery-main {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-9);
}
.gallery-section h2 {
  font-size: var(--text-lg);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-2);
  margin: 0 0 var(--space-4) 0;
}
.specimen-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
  align-items: flex-start;
}
.specimen {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  min-width: 140px;
}
.specimen-stage {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}
.specimen-label {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
/* --- state-demo wrappers: hover / focus-visible cannot be captured as real
   pseudo-classes in a static render, so we wrap the SAME default markup and
   paint the identical token the component's own hover:/focus-visible: class
   would apply. Un-layered rules always win over gallery.css's @layer'd
   Tailwind output, regardless of source order or specificity. */
.demo-hover {
  display: inline-flex;
  border-radius: var(--radius-md);
}
.demo-hover > * {
  background: var(--demo-bg) !important;
}
.demo-focus {
  display: inline-flex;
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
  border-radius: var(--radius-sm);
}
/* --- overlay neutralisation: Radix portals Dialog/DropdownMenu/Popover/
   Select/Tooltip content with fixed/computed inline positioning so it can
   float over the whole app. Inside the gallery we want it to sit inline in
   its specimen box instead, so its scrim never covers the page and its
   content never flies off to a fixed screen coordinate. */
.specimen-overlay {
  position: relative;
}
.specimen-overlay [data-radix-popper-content-wrapper] {
  position: static !important;
  transform: none !important;
  translate: none !important;
  inset: auto !important;
}
.specimen-overlay [role="dialog"],
.specimen-overlay [role="menu"],
.specimen-overlay [role="listbox"] {
  position: static !important;
  /* Tailwind v4 compiles -translate-x-1/2 to the standalone CSS "translate"
     property, not the legacy "transform" shorthand — both need resetting or
     the -50%/-50% centering offset survives "transform: none". */
  transform: none !important;
  translate: none !important;
  inset: auto !important;
  left: auto !important;
  top: auto !important;
  margin: 0 !important;
  max-height: none !important;
}
.specimen-overlay .bg-\\[var\\(--color-overlay\\)\\] {
  display: none;
}
/* Dialog's content sets a percentage width (w-[calc(100%-var(--space-6))])
   meant to resolve against the viewport under position:fixed. Once flipped to
   static flow inside an auto-sized specimen card, that percentage has no
   definite containing block to resolve against, so we give it one here rather
   than let it collapse or blow out unpredictably. */
.specimen-overlay-wide {
  width: 640px;
  max-width: calc(100vw - 96px);
}
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSection(section: Section): string {
  const specimensHtml = section.specimens
    .map((specimen) => {
      SPECIMEN_IDS.push(specimen.id);
      const stageClass = [
        "specimen-stage",
        specimen.overlay && "specimen-overlay",
        specimen.wide && "specimen-overlay-wide",
      ]
        .filter(Boolean)
        .join(" ");
      return `<div class="specimen" data-specimen-id="${escapeHtml(specimen.id)}">
  <div class="${stageClass}">${specimen.html}</div>
  <div class="specimen-label">${escapeHtml(specimen.label)}</div>
</div>`;
    })
    .join("\n");
  return `<section class="gallery-section" id="section-${escapeHtml(section.id)}" aria-label="${escapeHtml(section.title)}">
  <h2>${escapeHtml(section.title)}</h2>
  <div class="specimen-grid">
${specimensHtml}
  </div>
</section>`;
}

const HEADER_SCRIPT = `(function () {
  var params = new URLSearchParams(location.search);
  var theme = params.get("theme");
  var density = params.get("density");
  if (theme === "dark" || theme === "light") {
    document.documentElement.setAttribute("data-theme", theme);
  }
  if (density === "compact" || density === "comfortable") {
    document.documentElement.setAttribute("data-density", density);
  }
  function paint() {
    var currentTheme = document.documentElement.getAttribute("data-theme");
    var currentDensity = document.documentElement.getAttribute("data-density");
    document.querySelectorAll("[data-set-theme]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-set-theme") === currentTheme));
    });
    document.querySelectorAll("[data-set-density]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-set-density") === currentDensity));
    });
  }
  function wire() {
    document.querySelectorAll("[data-set-theme]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.documentElement.setAttribute("data-theme", btn.getAttribute("data-set-theme"));
        paint();
      });
    });
    document.querySelectorAll("[data-set-density]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.documentElement.setAttribute("data-density", btn.getAttribute("data-set-density"));
        paint();
      });
    });
    paint();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();`;

/**
 * Mounts every specimen, assembles the gallery chrome, and returns the full
 * standalone HTML document as a string. Only callable under jsdom.
 */
export function renderGallery(): string {
  ensureJsdomStubs();
  SPECIMEN_IDS.length = 0;
  skippedOverlays.length = 0;

  const sections: Section[] = [
    buildBrandSection(),
    buildButtonSection(),
    buildIconButtonSection(),
    buildInputSection(),
    buildTextareaSection(),
    buildSelectSection(),
    buildPickerSection(),
    buildCheckboxSection(),
    buildSwitchSection(),
    buildBadgeSection(),
    buildBadgeAllTonesSection(),
    buildCardSection(),
    buildGroupedListSection(),
    buildSectionLabelSection(),
    buildEmptyStateSection(),
    buildFieldSection(),
    buildTableSection(),
    buildTabsSection(),
    buildKbdSection(),
    buildSpinnerSection(),
    buildPageHeaderSection(),
    buildNavSection(),
    buildDialogSection(),
    buildDropdownMenuSection(),
    buildPopoverSection(),
    buildTooltipSection(),
    buildVirtualListSection(),
  ];

  const sectionsHtml = sections.map(renderSection).join("\n\n");

  return `<!doctype html>
<html lang="en" data-theme="light" data-density="comfortable">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1280, initial-scale=1" />
<title>Helix CRM — Component Gallery</title>
<link rel="icon" href="data:," />
<link rel="stylesheet" href="./gallery.css" />
<style>${GALLERY_STYLE}</style>
</head>
<body>
<header class="gallery-header">
  <div>
    <h1>Helix CRM component gallery</h1>
    <p>Every primitive in src/ui, every state that makes sense for it. Offline, static, no network calls.</p>
  </div>
  <div class="gallery-controls" role="group" aria-label="Theme">
    <button type="button" data-set-theme="light">Light</button>
    <button type="button" data-set-theme="dark">Dark</button>
  </div>
  <div class="gallery-controls" role="group" aria-label="Density">
    <button type="button" data-set-density="comfortable">Comfortable</button>
    <button type="button" data-set-density="compact">Compact</button>
  </div>
</header>
<main class="gallery-main">
${sectionsHtml}
</main>
<script>${HEADER_SCRIPT}</script>
</body>
</html>
`;
}

/** Overlays this pass could not force open in jsdom (reported, not fabricated). */
export function getSkippedOverlays(): string[] {
  return [...skippedOverlays];
}
