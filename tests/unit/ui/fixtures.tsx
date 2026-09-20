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
  ColumnHeaderCell,
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
  Select,
  Table,
  TH,
  THead,
  TR,
  VirtualList,
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

// ---------------------------------------------------------------------------
// Sortable header: the same "Name" column, click-to-sort state driving both
// TH (a real <table>, the pipeline's list view) and ColumnHeaderCell (the
// flex column strip above Contacts/Companies) - and, for ColumnHeaderCell,
// the very same "Sort" Select those two screens keep in sync with the header
// (apple-hig-review.md finding 6 / top-ten item 9).
// ---------------------------------------------------------------------------

const NAME_SORTS = [
  { value: "name-asc", label: "Name A to Z" },
  { value: "name-desc", label: "Name Z to A" },
];

function nameDirection(sort: string): "asc" | "desc" | null {
  if (sort === "name-asc") return "asc";
  if (sort === "name-desc") return "desc";
  return null;
}

export function TableSortFixture(props: { initialSort?: string }) {
  const [sort, setSort] = useState(props.initialSort ?? "newest");
  return (
    <Table>
      <THead>
        <TR>
          <TH
            sortable
            sortDirection={nameDirection(sort)}
            onSort={() => setSort(sort === "name-asc" ? "name-desc" : "name-asc")}
          >
            Name
          </TH>
        </TR>
      </THead>
    </Table>
  );
}

export function renderTableSortFixture(props?: { initialSort?: string }): RenderResult {
  return render(<TableSortFixture initialSort={props?.initialSort} />);
}

export function ColumnHeaderSortFixture(props: { initialSort?: string }) {
  const [sort, setSort] = useState(props.initialSort ?? "newest");
  return (
    <>
      <div role="row">
        <ColumnHeaderCell
          sortable
          sortDirection={nameDirection(sort)}
          onSort={() => setSort(sort === "name-asc" ? "name-desc" : "name-asc")}
        >
          Name
        </ColumnHeaderCell>
      </div>
      <Select
        ariaLabel="Sort"
        value={sort}
        options={NAME_SORTS}
        onValueChange={setSort}
      />
    </>
  );
}

export function renderColumnHeaderSortFixture(props?: { initialSort?: string }): RenderResult {
  return render(<ColumnHeaderSortFixture initialSort={props?.initialSort} />);
}

// ---------------------------------------------------------------------------
// Roving-tabindex row navigation: a VirtualList with `keyboardNav` wired the
// way ContactsScreen/CompaniesScreen wire it - a plain row that spreads its
// `nav` props, so Up/Down/Home/End move the roving tabIndex and Enter/Space
// activate it (apple-hig-review.md finding 6 / top-ten item 9).
// ---------------------------------------------------------------------------

export type RovingListRow = { id: string; label: string };

export function RovingListFixture(props: {
  items: RovingListRow[];
  onActivate: (id: string) => void;
  estimateSize?: number;
}) {
  const { items, onActivate, estimateSize } = props;
  return (
    <VirtualList<RovingListRow>
      items={items}
      ariaLabel="Rows"
      estimateSize={estimateSize ?? 48}
      getKey={(item) => item.id}
      keyboardNav={{ onActivate: (item) => onActivate(item.id) }}
      renderRow={(item, _index, nav) => (
        <div role="button" data-testid={item.id} {...nav}>
          {item.label}
        </div>
      )}
    />
  );
}

export function renderRovingListFixture(props: {
  items: RovingListRow[];
  onActivate: (id: string) => void;
  estimateSize?: number;
}): RenderResult {
  return render(
    <RovingListFixture items={props.items} onActivate={props.onActivate} estimateSize={props.estimateSize} />,
  );
}
