/**
 * LR-CS-W3, PIECE 3 / acceptance C3: Diagnostics' "Copy details" block.
 *
 * Walker needs exactly one thing from a client to start looking into a
 * problem: the Helix version, the OS, the workspace id, the two encryption
 * readings, the last backup time, the website connection state and the last
 * poll error - nothing about the client's own customers. `buildSupportDetails`
 * is a pure formatter over `Diagnostics`, so the first half of this file
 * checks its text directly; the second half proves the absence against a
 * workspace that actually has a contact, a company and a lead-sync error on
 * file, through the real `readDiagnostics()` read path, not a hand-built
 * object - so a future change that widens `Diagnostics` to read from a
 * customer record would fail this test rather than ship quietly.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../../repo/harness";
import { resetRegistryCache, writeRegistry } from "../../../src/app/appSettings";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";
import * as settingsRepo from "../../../src/db/repos/settings";
import * as leadSync from "../../../src/db/repos/leadSync";
import {
  buildSupportDetails,
  readDiagnostics,
  type Diagnostics,
} from "../../../src/features/settings/lib/diagnostics";

const WORKSPACE_ID = "support-block-workspace";
const SITE_ORIGIN = "https://sorensdatter-landscaping.example";

/** A `Diagnostics` value with every field filled in, for the pure-formatter half. */
function fullDiagnostics(overrides: Partial<Diagnostics> = {}): Diagnostics {
  return {
    appVersion: "0.1.0",
    db: { path: "/x/workspace.db", sizeBytes: 1024, sqliteVersion: "3.45.0", fts5: true, encrypted: true, cipherVersion: "4" },
    dbError: null,
    diskEncryption: { platform: "macos", encrypted: true, detail: "" },
    appData: "/x",
    workspacesDir: "/x/workspaces",
    workspaceId: "abc-123",
    workspaceName: "Sorensdatter Landscaping",
    migration: { version: "0009", appliedAt: "2026-09-01T00:00:00.000Z", count: 9 },
    lastBackupAt: "2026-09-20T08:00:00.000Z",
    siteOrigin: SITE_ORIGIN,
    lastPolledAt: "2026-09-20T09:00:00.000Z",
    lastPollError: null,
    keychain: true,
    logPath: "/x/logs/helix.log",
    ...overrides,
  };
}

describe("buildSupportDetails: the pure text block", () => {
  it("names every required field, once each, in a plain paste-able block", () => {
    const text = buildSupportDetails(fullDiagnostics(), { userAgent: "" });

    expect(text).toContain("Helix version: 0.1.0");
    expect(text).toContain("Operating system: macOS");
    expect(text).toContain("Workspace: abc-123");
    expect(text).toContain("Workspace file: Encrypted (SQLCipher 4)");
    expect(text).toMatch(/Disk encryption: .*on/i);
    expect(text).toContain(`Website: ${SITE_ORIGIN} - connected`);
    expect(text).toContain("Last error: None");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
    expect(text).not.toContain("[object Object]");
  });

  it("never guesses: an unencrypted-vs-unknown workspace file reads as Unknown, not as Not encrypted", () => {
    const unknown = buildSupportDetails(
      fullDiagnostics({ db: null }),
      { userAgent: "" },
    );
    expect(unknown).toContain("Workspace file: Unknown (this build cannot tell)");
    expect(unknown).not.toContain("Not encrypted");

    const off = buildSupportDetails(
      fullDiagnostics({
        db: { path: "/x/workspace.db", sizeBytes: 1, sqliteVersion: "3", fts5: true, encrypted: false, cipherVersion: undefined },
      }),
      { userAgent: "" },
    );
    expect(off).toContain("Workspace file: Not encrypted");
  });

  it("never guesses on disk encryption either: null reads as Unknown, not as off", () => {
    const text = buildSupportDetails(
      fullDiagnostics({ diskEncryption: { platform: "macos", encrypted: null, detail: "" } }),
      { userAgent: "" },
    );
    expect(text).toContain("Disk encryption: Unknown (could not check)");
  });

  it("says no site connected when there is none, and failing when the last poll recorded an error", () => {
    const noSite = buildSupportDetails(fullDiagnostics({ siteOrigin: null }), { userAgent: "" });
    expect(noSite).toContain("Website: No site connected");

    const failing = buildSupportDetails(
      fullDiagnostics({ lastPollError: "LeadPollAuthError: HTTP 401" }),
      { userAgent: "" },
    );
    expect(failing).toContain(`Website: ${SITE_ORIGIN} - failing`);
    expect(failing).toContain("Last error: LeadPollAuthError: HTTP 401");
  });

  it("says no backup has run yet rather than a blank or a guessed date", () => {
    const text = buildSupportDetails(fullDiagnostics({ lastBackupAt: null }), { userAgent: "" });
    expect(text).toContain("Last backup: No backup has run yet");
  });

  it("carries the user agent when one is given, as the OS version this build has cheaply", () => {
    const text = buildSupportDetails(fullDiagnostics(), {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    expect(text).toContain("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
  });
});

describe("buildSupportDetails: no customer data or secrets, against a populated workspace", () => {
  let h: Harness | null = null;

  const CONTACT_FIRST = "Zbigniew";
  const CONTACT_LAST = "Sorensdatter";
  const CONTACT_PHONE = "555-867-5309";
  const CONTACT_EMAIL = "zbigniew.sorensdatter@example-client.test";
  const CONTACT_NOTES = "Gate code is 4471, the dog is friendly but loud.";
  const CONTACT_ADDRESS = "742 Evergreen Terrace, Springfield";
  const COMPANY_NAME = "Sorensdatter Landscaping LLC";
  const RECOVERY_KEY_LOOKALIKE = "helix-recovery-9F2A-QQ7X-ZZ31-8KDM";
  const SITE_TOKEN_LOOKALIKE = "tok_live_do_not_leak_5f8a9c2b";

  beforeEach(async () => {
    h = await createHarness();
    resetRegistryCache();
    await writeRegistry({
      workspaces: [
        {
          id: WORKSPACE_ID,
          name: COMPANY_NAME,
          path: ":memory:",
          lastPolledAt: null,
          lastBackupAt: "2026-09-20T08:00:00.000Z",
          archived: false,
        },
      ],
      lastOpened: WORKSPACE_ID,
      theme: "light",
      density: "comfortable",
      sidebar: { width: 240, collapsed: false },
    });

    const company = await companies.create({ name: COMPANY_NAME });
    await contacts.create({
      firstName: CONTACT_FIRST,
      lastName: CONTACT_LAST,
      companyId: company.id,
      addressJson: JSON.stringify({ line1: CONTACT_ADDRESS }),
      notes: CONTACT_NOTES,
      phones: [{ raw: CONTACT_PHONE, label: "mobile", isPrimary: true }],
      emails: [{ email: CONTACT_EMAIL, label: "work", isPrimary: true }],
    });

    await settingsRepo.set("siteOrigin", SITE_ORIGIN);
    await leadSync.ensure(SITE_ORIGIN);
    await leadSync.recordError(SITE_ORIGIN, "LeadPollAuthError: HTTP 401");
  });

  afterEach(() => {
    h?.dispose();
    h = null;
    resetRegistryCache();
  });

  it("reads real diagnostics against a workspace with a contact and a company on file, and the block names none of them", async () => {
    const data = await readDiagnostics();
    // Sanity: the read actually found the workspace and the site state this
    // test set up, so the assertions below are checking a real block, not an
    // empty one that would trivially pass.
    expect(data.workspaceId).toBe(WORKSPACE_ID);
    expect(data.siteOrigin).toBe(SITE_ORIGIN);
    expect(data.lastPollError).toBe("LeadPollAuthError: HTTP 401");

    const text = buildSupportDetails(data, { userAgent: "" });

    // The required fields are there.
    expect(text).toContain(`Workspace: ${WORKSPACE_ID}`);
    expect(text).toContain(`Website: ${SITE_ORIGIN} - failing`);
    expect(text).toContain("Last error: LeadPollAuthError: HTTP 401");

    // Nothing about the customer on file is.
    expect(text).not.toContain(CONTACT_FIRST);
    expect(text).not.toContain(CONTACT_LAST);
    expect(text).not.toContain(CONTACT_PHONE);
    expect(text).not.toContain(CONTACT_EMAIL);
    expect(text).not.toContain(CONTACT_NOTES);
    expect(text).not.toContain(CONTACT_ADDRESS);
    expect(text).not.toContain(COMPANY_NAME);
    // Nor the workspace's own display name, which happens to be the company
    // name here - the block names the workspace only by its id.
    expect(text).not.toContain(data.workspaceName ?? "\0");

    // Nor any secret: Diagnostics never reads a recovery key or a site
    // token in the first place, so this is a belt-and-braces check against a
    // value shaped like one, not a claim that this test could plant one to
    // check.
    expect(text).not.toContain(RECOVERY_KEY_LOOKALIKE);
    expect(text).not.toContain(SITE_TOKEN_LOOKALIKE);

    // No stray field ever reads as a bare exception or a guess.
    expect(text).not.toContain("[object Object]");
    expect(text).not.toContain("undefined");
  });
});
