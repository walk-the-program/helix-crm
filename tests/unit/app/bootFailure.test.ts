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
import { DbError, DbOpenError, Fts5MissingError, SecretStoreError } from "@/db/client";
import { MigrationError, NewerSchemaError, newerSchemaMessage } from "@/db/migrator";
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

    renderBootFailure({ error: new MigrationError("0003_money", "no such column", null, null) });
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

  it("sends a refused keychain to its own screen, not to the file-locked one (LR-OPS F-OPS-5)", () => {
    // What secrets.rs writes when macOS hands back a denial. An unsigned build
    // reprompts after every rebuild, so this is the single most likely way an
    // owner ever sees a boot failure at all.
    const denied = new SecretStoreError(
      "This machine's keychain turned Helix down, so Helix cannot reach this " +
        "workspace's key. Quit Helix, open it again, and choose Always Allow " +
        "when the keychain asks. Nothing on disk has been changed. (User canceled)",
    );
    renderBootFailure({ error: denied, path: "/w/helix.db", onRetry: () => {} });

    expect(screen.getByRole("heading").textContent).toContain("keychain");
    expect(document.body.textContent).toContain("choose Always Allow");
    // The two wrong causes the old screen offered.
    expect(document.body.textContent).not.toContain("Another copy of Helix");
    expect(document.body.textContent).not.toContain("may not be writable");
    // Trying again is the right move here: the prompt comes back.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeNull();
  });

  it("gives a newer-than-this-build workspace its own screen, distinct from a failed migration (LR-OPS-W1 A1/A2)", () => {
    const error = new NewerSchemaError(["0099_future"], newerSchemaMessage());
    renderBootFailure({ error });

    // Its own heading, not the migration-failure one.
    expect(screen.getByRole("heading").textContent).toContain("newer Helix");
    expect(screen.getByRole("heading").textContent).not.toContain("update");

    // The exact message string, word for word.
    expect(document.body.textContent).toContain(newerSchemaMessage());

    // Never offers to downgrade, delete or repair, and never invents a
    // "Try again" that would just fail the same way a second time.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain("delete");
    expect(document.body.textContent?.toLowerCase()).not.toContain("repair");
    expect(document.body.textContent?.toLowerCase()).not.toContain("downgrade");

    cleanup();

    // And a real failed migration still renders as itself, not this screen.
    renderBootFailure({
      error: new MigrationError("0003_money", "no such column", null, null),
    });
    expect(screen.getByRole("heading").textContent).toContain("update");
    expect(screen.getByRole("heading").textContent).not.toContain("newer Helix");
  });
});
