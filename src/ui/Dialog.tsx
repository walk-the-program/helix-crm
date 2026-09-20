import { Children, createContext, forwardRef, isValidElement, useContext, useState } from "react";
import type { ComponentPropsWithoutRef, ElementRef, HTMLAttributes, ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/Button";
import { focusRing, headingFont, quietTransition } from "@/ui/styles";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/**
 * 480px for a confirm, 680px for a form (docs/DESIGN.md §9 "Dialogs"). `lg` is
 * the reference sheet: wider than a form, still not the whole window.
 */
const sizeClasses = {
  sm: "max-w-[480px]",
  md: "max-w-[680px]",
  lg: "max-w-[840px]",
} as const;

/**
 * True for the one `DialogFooter` that `DialogContent` hoisted out of the
 * scroll box. Any other footer — nested inside a feature's own wrapper, so it
 * could not be found — reads false and keeps pinning itself.
 */
const HoistedFooterContext = createContext(false);

/** Split the single top-level `DialogFooter` (if there is one) off the rest. */
function splitFooter(children: ReactNode): { body: ReactNode[]; footer: ReactNode | null } {
  const kids = Children.toArray(children);
  const index = kids.findIndex((child) => isValidElement(child) && child.type === DialogFooter);
  if (index === -1) return { body: kids, footer: null };
  return {
    body: [...kids.slice(0, index), ...kids.slice(index + 1)],
    footer: kids[index],
  };
}

/**
 * A floating panel: raised surface, one hairline, --radius-lg, the single
 * ultra-diffuse shadow, over a light scrim. Nothing else is elevated in this
 * product.
 *
 * **It is height-bound.** The content column is capped at
 * `100vh - 2 * --space-9`, the body scrolls internally, `DialogHeader` sticks
 * to the top of that scroll box and the footer sits below it. Without the cap,
 * a form taller than the window ran its footer off-screen and the Save button
 * was unreachable — the settings e2e caught exactly that on the paste dialog.
 * Every call site gets the fix without changing a line.
 *
 * **The footer is hoisted out of the scroll box** (round 3, criterion 10).
 * It used to be `position: sticky` INSIDE the scroller, which looked right at
 * rest and was wrong the moment anything scrolled: a field passing under the
 * pinned bar sat behind it with nothing between them, and at the bottom of a
 * Create contact form the email field read as touching the buttons. Sticky
 * cannot fix that, because a sticky element still occupies its flow position
 * and overlays whatever passes it.
 *
 * So `DialogContent` pulls the `DialogFooter` out of `children` and renders it
 * as a flex sibling BELOW the scroll box, which is what a native sheet does.
 * The scroll box then owns a real `pb-[var(--space-6)]`, and because nothing
 * cancels it any more, there is at least 24px between the last field and the
 * footer in every state — scrolled, unscrolled, and mid-scroll. A footer that
 * is nested inside something else (so it cannot be hoisted) keeps the old
 * sticky behaviour rather than losing its pinning; `DialogFooter` reads which
 * case it is in from a context this component sets.
 *
 * **It is also width-bound.** `w-[calc(100%-var(--space-6))]` sizes off the
 * viewport (this is a `fixed` element, so "100%" is the window, not a parent),
 * so a dialog can never get wider than the window minus a gutter even at the
 * 1024px floor — the `size` cap just tightens that further for a given
 * dialog. `overflow-x: hidden` on the scroll box below is the backstop: a
 * feature row that gets its own width math wrong (a stray fixed width, an
 * untruncated line) clips at the dialog's edge instead of pushing the whole
 * panel wider or leaving a check mark or trailing action hanging off the
 * right side, which is what the workspace switcher did before this line was
 * added.
 */
/**
 * Where focus goes when a dialog closes and there is nowhere to send it back
 * to. Put it on the shell's main region; `main` is the fallback.
 */
const FOCUS_FALLBACK = "[data-dialog-focus-fallback]";

/**
 * Radix restores focus to whatever held it when the dialog opened. That is the
 * right answer for a dialog opened from a button, and no answer at all for one
 * opened from a keyboard shortcut: "?" is pressed while nothing is focused, so
 * the element Radix restores to is `document.body`, and closing the shortcuts
 * sheet leaves the keyboard at the very top of the document — the next Tab
 * starts again from the first sidebar link instead of resuming where the user
 * was (Lead C's phase-one design note).
 *
 * So when the restore target is missing, detached or the body itself, focus
 * goes to the shell's main region instead. A caller that passes its own
 * `onCloseAutoFocus` still wins, and one that calls `preventDefault()` still
 * places focus itself.
 */
function returnFocus() {
  // The timer below can outlive its document: a test environment that tears
  // the DOM down while a dialog is unmounting, for one.
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active && active !== document.body && document.contains(active)) return;
  const fallback =
    document.querySelector<HTMLElement>(FOCUS_FALLBACK) ??
    document.querySelector<HTMLElement>("main");
  if (!fallback) return;
  if (!fallback.hasAttribute("tabindex")) fallback.setAttribute("tabindex", "-1");
  fallback.focus({ preventScroll: true });
}

export const DialogContent = forwardRef<
  ElementRef<typeof RadixDialog.Content>,
  ComponentPropsWithoutRef<typeof RadixDialog.Content> & { size?: keyof typeof sizeClasses }
>(({ className, size = "md", children, onCloseAutoFocus, ...props }, ref) => {
  const { body, footer } = splitFooter(children);
  return (
  <RadixDialog.Portal>
    {/* The scrim is its own token: a light dim, not a black wash. */}
    <RadixDialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-overlay)]" />
    <RadixDialog.Content
      ref={ref}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (event.defaultPrevented) return;
        // Radix has not moved focus yet at this point, so let it, then check
        // where it landed. Nothing is stolen from a real restore target: the
        // check below only fires when focus came to rest on the body.
        window.setTimeout(returnFocus, 0);
      }}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-var(--space-6))]",
        sizeClasses[size],
        "flex max-h-[calc(100vh-var(--space-9)*2)] flex-col overflow-hidden",
        "border border-[var(--color-border)]",
        "bg-[var(--color-surface-raised)] shadow-[var(--shadow-lg)]",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      {/* The one scroller. `pb-[var(--space-6)]` is the kit's dialog-spacing
          rule made structural: the last field always keeps 24px off the
          footer. `scroll-pb` repeats it for `scrollIntoView`, so tabbing to
          the last field never parks it half under the bar. */}
      <div
        data-testid="dialog-body"
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
          "px-[var(--space-6)] pt-[var(--space-5)] pb-[var(--space-6)]",
          "scroll-pb-[var(--space-6)]",
        )}
      >
        <HoistedFooterContext.Provider value={false}>{body}</HoistedFooterContext.Provider>
      </div>
      {footer ? (
        <HoistedFooterContext.Provider value={true}>{footer}</HoistedFooterContext.Provider>
      ) : null}
      <RadixDialog.Close asChild>
        <button
          type="button"
          aria-label="Close"
          className={cn(
            "absolute right-[var(--space-3)] top-[var(--space-3)] z-[2]",
            "inline-flex flex-none items-center justify-center",
            "w-[var(--control-h-sm)] h-[var(--control-h-sm)]",
            "text-[var(--color-text-muted)]",
            "enabled:hover:bg-[var(--color-hover)] enabled:hover:text-[var(--color-text)]",
            quietTransition,
            focusRing,
          )}
        >
          <X size={16} weight="bold" aria-hidden="true" />
        </button>
      </RadixDialog.Close>
    </RadixDialog.Content>
  </RadixDialog.Portal>
  );
});
DialogContent.displayName = "DialogContent";

/** Pinned to the top of the dialog's scroll box; the body scrolls under it. */
export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky top-0 z-[1] -mx-[var(--space-6)] -mt-[var(--space-5)]",
        "mb-[var(--space-4)] px-[var(--space-6)] pb-[var(--space-3)] pt-[var(--space-5)]",
        "bg-[var(--color-surface-raised)]",
        "flex flex-col gap-[var(--space-1)] pr-[var(--space-9)]",
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  ElementRef<typeof RadixDialog.Title>,
  ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...props }, ref) => (
  <RadixDialog.Title
    ref={ref}
    className={cn(
      headingFont,
      "text-[length:var(--text-subhead)] font-bold",
      "leading-[var(--leading-subhead)]",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
  ElementRef<typeof RadixDialog.Description>,
  ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(({ className, ...props }, ref) => (
  <RadixDialog.Description
    ref={ref}
    className={cn("text-[length:var(--text-base)] text-[var(--color-text-muted)]", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

/**
 * The action bar. Always visible, however tall the form is.
 *
 * Two shapes, chosen for it rather than by it. HOISTED (the normal case):
 * `DialogContent` found it and rendered it outside the scroll box, so it is a
 * plain flex-none bar and the 24px of air above it is the scroller's own
 * bottom padding. NESTED (a feature wrapped it in something, so it could not
 * be hoisted): it falls back to the old `position: sticky` treatment, which
 * keeps it on screen at the cost of content passing behind it.
 */
export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const hoisted = useContext(HoistedFooterContext);
  return (
    <div
      data-testid="dialog-footer"
      data-hoisted={hoisted ? "true" : "false"}
      className={cn(
        "flex flex-wrap items-center justify-end gap-[var(--space-2)]",
        "bg-[var(--color-surface-raised)] border-t border-[var(--color-border)]",
        hoisted
          ? "flex-none px-[var(--space-6)] pb-[var(--space-5)] pt-[var(--space-4)]"
          : [
              "sticky bottom-0 z-[1] -mx-[var(--space-6)] -mb-[var(--space-6)]",
              "mt-[var(--space-6)] px-[var(--space-6)] pb-[var(--space-5)] pt-[var(--space-3)]",
            ].join(" "),
        className,
      )}
      {...props}
    />
  );
}

/**
 * Cancel sits to the left of the confirm, and it is the first focusable thing
 * in the dialog: the safe action is the one the keyboard lands on.
 *
 * A destructive confirm is the one place a red FILL is allowed — the sentence
 * above it has already explained what the red means.
 */
export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const {
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive,
    onConfirm,
  } = props;
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            solid={destructive}
            onClick={handleConfirm}
            loading={pending}
            loadingLabel={`${confirmLabel}…`}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
