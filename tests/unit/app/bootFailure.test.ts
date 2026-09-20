// @vitest-environment jsdom
/**
 * Which boot screen a failure gets, and what the owner can do from it
 * (F-LC-10).
 *
 * The bug this pins: `openWorkspace` wrapped EVERY throw from `raw.open` in a
 * `DbOpenError`, so a TypeError raised before the database pipe was even
 * reachable arrived at a screen headed "Helix can't open your data" telling
 * the owner another copy of Helix might have the file or the folder might not
 * be writable. Both plausible, both wrong. A cause we cannot name must be
 * shown as a cause we cannot name.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { DbError, DbOpenError, Fts5MissingError } from "@/db/client";
import { MigrationError } from "@/db/migrator";
import { renderBootFailure } from "./bootFailure.fixtures";

afterEach(() => {
  cleanup();
});

describe("BootFailure", () => {
  it("tells the file-locked story only for a real database-open failure", () => {
    renderBootFailure({ error: new DbOpenError("could not open the file") });
    expect(screen.getByRole("heading").textContent).toContain("can't open your data");
    expect(document.body.textContent).toContain("Another copy of Helix may have it");
  });

  it("does not invent a cause for a failure that is not the database", () => {
    // Exactly what the harness produced when the Tauri shim was not installed
    // in time, and what the owner would see if anything threw before the pipe.
    const thrown = new TypeError("Cannot read properties of undefined (reading 'invoke')");
    renderBootFailure({ error: thrown });

    expect(screen.getByRole("heading").textContent).toContain("Helix could not start");
    expect(document.body.textContent).not.toContain("Another copy of Helix");
    expect(document.body.textContent).not.toContain("may not be writable");
    // The detail is still shown rather than swallowed.
    expect(document.body.textContent).toContain("reading 'invoke'");
  });

  it("still routes the two other named failures to their own screens", () => {
    renderBootFailure({ error: new Fts5MissingError() });
    expect(screen.getByRole("heading").textContent).toContain("missing search");
    cleanup();

    renderBootFailure({ error: new MigrationError("0003_money", "no such column") });
    expect(screen.getByRole("heading").textContent).toContain("update");
  });

  it("offers a way out of the error screen, not only a way to hit it again", () => {
    renderBootFailure({
      error: new DbOpenError("locked"),
      path: "/Users/someone/Library/Application Support/Helix/workspaces/w1/helix.db",
      onRetry: () => {},
    });
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    // The folder is where the backups are, and it needs no database.
    expect(screen.getByRole("button", { name: "Show the workspace folder" })).toBeTruthy();
  });

  it("shows no folder button when there is no path to show", () => {
    renderBootFailure({ error: new DbOpenError("locked"), onRetry: () => {} });
    expect(screen.queryByRole("button", { name: "Show the workspace folder" })).toBeNull();
  });

  it("gives the generic screen the same escape", () => {
    renderBootFailure({
      error: new Error("something else entirely"),
      path: "/tmp/w1/helix.db",
    });
    expect(screen.getByRole("button", { name: "Show the workspace folder" })).toBeTruthy();
  });

  it("treats a database error of another code as an open failure, not a mystery", () => {
    // An IO_ERROR out of the pipe IS the file not opening, whatever the code.
    renderBootFailure({ error: new DbError("IO_ERROR", "disk went away") });
    expect(screen.getByRole("heading").textContent).toContain("Helix could not start");
    expect(document.body.textContent).toContain("disk went away");
  });
});
