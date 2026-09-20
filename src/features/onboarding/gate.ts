/**
 * The gate: does the owner see setup, or the shell?
 *
 * Three things have to be true at the same time, and all three are cheap:
 *
 *  1. `onboarding.completedAt` is null — he has never finished setup;
 *  2. `onboarding.skippedAt` is null — he has never said "not now";
 *  3. the workspace holds no contacts and no deals.
 *
 * The third is what keeps the gate honest. A workspace with rows in it is a
 * workspace somebody is already using, and a first-run flow in front of it
 * would be a bug no matter what the settings say. It is also why the gate never
 * has to be reset by hand after an import or a restore.
 *
 * Once either timestamp is set the flow never appears on its own again. It is
 * still reachable, on purpose, from "/setup" and from the "Set up your
 * business" command.
 *
 * This module is imported by `src/app/boot.ts`, which is the one shell file the
 * onboarding feature touches. It reads through the repositories and nothing
 * else, so importing it from boot cannot pull the React tree in behind it.
 */
import * as contactsRepo from "@/db/repos/contacts";
import * as dealsRepo from "@/db/repos/deals";
import { readOnboardingState } from "@/features/onboarding/lib/settings";

/**
 * The e2e harness's stand-in for a settings row.
 *
 * Every spec in `tests/e2e-mac` starts from an empty workspace and its first
 * `page.goto("/")` expects the shell, so without this the gate would fire in
 * front of all of them. It cannot be arranged as a real setting: the `settings`
 * table does not exist until the app itself runs the first migration, which
 * happens after the page has loaded. So the harness sets a flag instead, and
 * `tests/e2e-mac/fixtures.ts` defaults it on — a spec that wants to see the
 * flow declares `test.use({ onboarding: "show" })`.
 *
 * `import.meta.env.VITE_E2E` is only defined in the e2e build, so in a shipped
 * build this whole branch is dead code and no global can reach the gate.
 */
function harnessSkip(): boolean {
  if (!import.meta.env.VITE_E2E) return false;
  if (typeof window === "undefined") return false;
  return (window as { __helixSkipOnboarding?: boolean }).__helixSkipOnboarding === true;
}

export async function workspaceHasRecords(): Promise<boolean> {
  const [contacts, deals] = await Promise.all([
    contactsRepo.list({}, { limit: 1 }),
    dealsRepo.list({}, { limit: 1 }),
  ]);
  return contacts.total > 0 || deals.total > 0;
}

export async function shouldShowOnboarding(): Promise<boolean> {
  if (harnessSkip()) return false;
  const { completedAt, skippedAt } = await readOnboardingState();
  if (completedAt || skippedAt) return false;
  return !(await workspaceHasRecords());
}
