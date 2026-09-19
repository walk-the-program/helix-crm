// @vitest-environment jsdom
/**
 * JSX render helpers shared by the tests/unit/ui/*.test.ts files.
 *
 * Vitest's include pattern only picks up "*.test.ts" files, so JSX cannot
 * live in the test files themselves. These helpers wrap the JSX and expose
 * plain functions the .test.ts files can call without touching JSX syntax.
 */
import { useState } from "react";
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function DialogFixture(props: {
  onOpenChangeSpy?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        props.onOpenChangeSpy?.(next);
      }}
    >
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete company</DialogTitle>
          <DialogDescription>This removes the record.</DialogDescription>
        </DialogHeader>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </DialogContent>
    </Dialog>
  );
}

export function renderDialogFixture(props?: {
  onOpenChangeSpy?: (open: boolean) => void;
  defaultOpen?: boolean;
}): RenderResult {
  return render(<DialogFixture onOpenChangeSpy={props?.onOpenChangeSpy} defaultOpen={props?.defaultOpen} />);
}

// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------

export function ConfirmDialogFixture(props: {
  onConfirm?: () => void | Promise<void>;
  onOpenChangeSpy?: (open: boolean) => void;
  destructive?: boolean;
  defaultOpen?: boolean;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        props.onOpenChangeSpy?.(next);
      }}
      title="Delete company"
      description="This can't be undone."
      confirmLabel={props.confirmLabel ?? "Delete"}
      destructive={props.destructive}
      onConfirm={props.onConfirm ?? (() => {})}
    />
  );
}

export function renderConfirmDialogFixture(props?: {
  onConfirm?: () => void | Promise<void>;
  onOpenChangeSpy?: (open: boolean) => void;
  destructive?: boolean;
  defaultOpen?: boolean;
  confirmLabel?: string;
}): RenderResult {
  return render(
    <ConfirmDialogFixture
      onConfirm={props?.onConfirm}
      onOpenChangeSpy={props?.onOpenChangeSpy}
      destructive={props?.destructive}
      defaultOpen={props?.defaultOpen}
      confirmLabel={props?.confirmLabel}
    />,
  );
}

// ---------------------------------------------------------------------------
// DropdownMenu
// ---------------------------------------------------------------------------

export function DropdownMenuFixture(props: {
  onSelectAlpha?: () => void;
  onSelectGamma?: () => void;
  onOpenChangeSpy?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        props.onOpenChangeSpy?.(next);
      }}
    >
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={props.onSelectAlpha}>Alpha</DropdownMenuItem>
        <DropdownMenuItem disabled onSelect={props.onSelectGamma}>
          Beta (disabled)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onSelectGamma}>Gamma</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={false}>Show archived</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function renderDropdownMenuFixture(props?: {
  onSelectAlpha?: () => void;
  onSelectGamma?: () => void;
  onOpenChangeSpy?: (open: boolean) => void;
  defaultOpen?: boolean;
}): RenderResult {
  return render(
    <DropdownMenuFixture
      onSelectAlpha={props?.onSelectAlpha}
      onSelectGamma={props?.onSelectGamma}
      onOpenChangeSpy={props?.onOpenChangeSpy}
      defaultOpen={props?.defaultOpen}
    />,
  );
}
