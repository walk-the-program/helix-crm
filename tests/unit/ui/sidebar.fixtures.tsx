// @vitest-environment jsdom
/**
 * JSX render helpers for sidebar.test.ts (round 3: resize, collapse, groups).
 * Vitest only collects *.test.ts, so the JSX lives here.
 */
import { useState } from "react";
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { Sidebar, SidebarSection, SidebarSeparator, NavItem, TooltipProvider } from "@/ui";

/** The sidebar as the shell mounts it: brand, two groups with a rule between
 *  them, a footer, and a width the fixture owns so a drag is observable. */
export function SidebarFixture(props: {
  initialWidth?: number;
  collapsed?: boolean;
  onResizeEnd?: (w: number) => void;
}) {
  const [width, setWidth] = useState(props.initialWidth ?? 240);
  return (
    <TooltipProvider>
      <Sidebar
        width={width}
        collapsed={props.collapsed}
        onResize={setWidth}
        onResizeEnd={props.onResizeEnd}
        brand={<span>Helix</span>}
        footer={<span>My business</span>}
      >
        <SidebarSection collapsed={props.collapsed}>
          <NavItem label="Today" active collapsed={props.collapsed} />
          <NavItem label="Contacts" collapsed={props.collapsed} />
        </SidebarSection>
        <SidebarSeparator />
        <SidebarSection label="Pinned views" collapsed={props.collapsed}>
          <NavItem label="Gone quiet" collapsed={props.collapsed} />
        </SidebarSection>
      </Sidebar>
    </TooltipProvider>
  );
}

export function renderSidebar(props?: {
  initialWidth?: number;
  collapsed?: boolean;
  onResizeEnd?: (w: number) => void;
}): RenderResult {
  return render(
    <SidebarFixture
      initialWidth={props?.initialWidth}
      collapsed={props?.collapsed}
      onResizeEnd={props?.onResizeEnd}
    />,
  );
}
