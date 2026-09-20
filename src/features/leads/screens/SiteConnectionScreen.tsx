/**
 * Settings -> Website (/settings/site).
 *
 * Two halves of one connection: the address, which lives in the workspace's
 * `settings` table, and the token, which lives in the OS keychain and never
 * enters SQLite or helix.json (docs/PLAN.md, "Security and threat model"). The
 * token is write-only in this UI: once it is saved, the screen can say that a
 * token is stored but never shows it again, because reading it back into the
 * webview would defeat the point of keeping it in Rust.
 *
 * The settings feature mounts this screen at "/settings/site"; this folder owns
 * it. The shape is the settings shape: three grouped inset lists under
 * small-capitals labels, and the facts about the poll as label-and-value rows
 * rather than a table. "Save" is the screen's one primary button and its one
 * block of brand primary; Test connection and Poll now are secondary, and
 * Disconnect is the destructive text button.
 */
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwise, Globe, LinkBreak } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardGroupLabel,
  CardRow,
  ConfirmDialog,
  Field,
  FormRow,
  Input,
  PageHeader,
  Select,
  toast,
} from "@/ui";
import * as leadSync from "@/db/repos/leadSync";
import { useFormats } from "@/app/formats";
import { HelpLink } from "@/features/help";
import { PollBanner } from "@/features/leads/components/PollBanner";
import { usePollStatus, leadKeys } from "@/features/leads/hooks";
import {
  checkOrigin,
  checkToken,
  disconnectSite,
  readSiteConnection,
  saveSiteOrigin,
  setSiteToken,
  syncKeyFor,
} from "@/features/leads/lib/siteConnection";
import {
  describeStoredPollError,
  storedPollErrorDetail,
} from "@/features/leads/lib/pollMessages";
import { invokeLeadsFetch } from "@/features/leads/lib/leadsFetch";
import { POLL_INTERVAL_MS, refresh, tick } from "@/features/leads/poller";
import { statusFromError, isAuthStatus } from "@/features/leads/lib/backoff";

const POLL_MINUTES = POLL_INTERVAL_MS / 60_000;

type TestResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** So `save`'s error handler knows which of the two fields to point at. */
class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/**
 * The readable text out of whatever this screen's mutations rejected with.
 *
 * `setSiteToken`, `disconnectSite` and `invokeLeadsFetch` (through
 * `saveSiteOrigin` / the keychain / `leads_fetch`) all end in a raw
 * `invoke()`, and Tauri v2 rejects a command with a plain `{ code, message }`
 * object, not an `Error` - the exact trap `src/features/leads/poller.ts` and
 * `src/features/data/lib/backupsFs.ts` already name and fix (F-LB-6):
 * `err instanceof Error` is false for that shape, and `String(err)` on a
 * plain object gives "[object Object]", which this screen was showing
 * verbatim under the address or token field, or in the disconnect toast, for
 * any real keychain or network failure.
 */
function messageFrom(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(err);
}

export function SiteConnectionScreen() {
  const queryClient = useQueryClient();
  const formats = useFormats();
  const status = usePollStatus();

  const connection = useQuery({
    queryKey: leadKeys.connection(),
    queryFn: readSiteConnection,
  });

  const sync = useQuery({
    queryKey: leadKeys.sync(connection.data?.siteOrigin ?? null),
    queryFn: async () => {
      const origin = connection.data?.siteOrigin;
      return origin ? leadSync.get(syncKeyFor(origin)) : null;
    },
    enabled: connection.isSuccess,
  });

  const [origin, setOrigin] = useState("");
  const [originError, setOriginError] = useState<string | undefined>();
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | undefined>();
  /**
   * What a changed address means. Helix cannot tell a domain move from a
   * different website, and the two need opposite handling, so it asks - and
   * defaults to the one a ClearPath client actually does (staging to live,
   * apex to www). See `saveSiteOrigin`.
   */
  const [addressChange, setAddressChange] = useState<"same" | "different">("same");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  // Fill the address box from the stored setting once it has loaded, and only
  // while the owner has not started typing his own.
  const storedOrigin = connection.data?.siteOrigin ?? null;
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && storedOrigin !== null) setOrigin(storedOrigin);
  }, [storedOrigin, touched]);

  const reloadAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["leads"] });
    await refresh();
  }, [queryClient]);

  const save = useMutation({
    mutationFn: async () => {
      // Both halves are checked before either is written. Validating the
      // address, saving it, and only then rejecting the token left a
      // half-saved connection behind - an address on file with no token,
      // which reads as "Not connected" without saying why (LR-REV, F-REV-8).
      const checked = checkOrigin(origin);
      if (!checked.ok) throw new Error(checked.message);
      // An empty box means "leave the stored token alone", which is how the
      // owner changes only the address without retyping a 44-character key.
      const typed = token.trim().length > 0 ? checkToken(token) : null;
      if (typed && !typed.ok) throw new TokenError(typed.message);

      await saveSiteOrigin(checked.origin, {
        carryCursorFrom:
          storedOrigin && addressChange === "same" ? storedOrigin : null,
      });
      if (typed?.ok) await setSiteToken(typed.token);
      return checked.origin;
    },
    onSuccess: async () => {
      setToken("");
      setTestResult(null);
      setOriginError(undefined);
      setTokenError(undefined);
      setAddressChange("same");
      toast.success("Website connection saved");
      await reloadAll();
    },
    onError: (err: unknown) => {
      const message = messageFrom(err);
      // A bad token is a bad token, not a bad address: putting its message
      // under the address field sent the owner to fix the wrong box.
      if (err instanceof TokenError) setTokenError(message);
      else setOriginError(message);
      toast.error(message);
    },
  });

  /**
   * "Test connection" asks for exactly one lead with a null cursor. A null
   * cursor means "from the beginning" and the Rust command omits `after`
   * entirely (docs/CONTRACTS.md); nothing is written, so this is safe to press
   * as often as the owner likes.
   */
  const test = useMutation({
    mutationFn: () => invokeLeadsFetch(null, 1),
    onSuccess: (page) => {
      setTestResult({
        ok: true,
        message:
          page.leads.length > 0
            ? // Asking for one lead from the beginning returns the site's
              // OLDEST lead, which is almost always one Helix already has.
              // Calling it "waiting" read as though leads were stuck
              // (LR-REV, F-REV-7).
              `Connected. Your website answered; its oldest lead is from ${formats.dateTime(page.leads[0].createdAt)}.`
            : "Connected. There are no new leads waiting right now.",
      });
    },
    onError: (err: unknown) => {
      setTestResult({ ok: false, message: describeFetchError(err) });
    },
  });

  const pollNow = useMutation({
    mutationFn: () => tick("manual"),
    onSuccess: async (outcome) => {
      if (outcome.error) {
        toast.error(outcome.error.message);
      } else if (!outcome.ran) {
        toast.info(
          outcome.reason === "not-configured"
            ? "Add your website address and token first."
            : "Helix is busy with another job. It will poll in a moment.",
        );
      } else if (outcome.created === 0) {
        toast.success("Checked your website. Nothing new.");
      } else {
        toast.success(
          outcome.created === 1
            ? "1 new lead came in."
            : `${outcome.created} new leads came in.`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await sync.refetch();
    },
  });

  const disconnect = useMutation({
    mutationFn: disconnectSite,
    onSuccess: async () => {
      setConfirmingDisconnect(false);
      setOrigin("");
      setToken("");
      setTouched(false);
      setTestResult(null);
      setTokenError(undefined);
      toast.success("Website disconnected. Your leads stay where they are.");
      await reloadAll();
    },
    onError: (err: unknown) => {
      // Usually the keychain refusing to delete. Before this the dialog just
      // sat there and the owner had no idea it had failed (LR-REV, F-REV-9).
      setConfirmingDisconnect(false);
      toast.error(`Helix could not disconnect your website. ${messageFrom(err)}`);
    },
  });

  const connected = connection.data?.connected ?? false;
  const hasToken = connection.data?.hasToken ?? false;
  /**
   * "Test connection" goes through `leads_fetch`, which reads the SAVED
   * address and the SAVED token out of the keychain - it cannot see what is
   * in these two boxes. So an owner who pasted a freshly rotated token and
   * pressed Test was told his old token still worked, or still failed, and
   * either way learned nothing about the one he had just typed (LR-REV,
   * F-REV-3). Rather than quietly saving on his behalf from a button that
   * does not say so, the button waits for Save and says why.
   */
  const typedOrigin = origin.trim().replace(/\/+$/, "");
  const unsavedEdits = token.trim().length > 0 || (touched && typedOrigin !== (storedOrigin ?? ""));
  /**
   * The owner is pointing Helix somewhere else. Saving this used to silently
   * re-read the new address from the beginning, and because a lead's
   * idempotency key carries the origin, every lead already on file came back
   * as a second job (LR-REV, F-REV-11).
   */
  const addressChanged =
    Boolean(storedOrigin) && typedOrigin.length > 0 && typedOrigin !== storedOrigin;
  const lastPolledAt = sync.data?.lastPolledAt ?? status.lastPolledAt;
  const lastError = sync.data?.lastError ?? null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Website"
        subtitle="Leads from your ClearPath site land here on their own."
      />

      <div className="flex max-w-[46rem] flex-col gap-[var(--space-6)]">
        <PollBanner
          status={status}
          action={<HelpLink to="website-leads">How this works</HelpLink>}
        />

        <div>
          <CardGroupLabel>Connection</CardGroupLabel>
          <Card>
            <CardRow>
              <span className="text-[var(--color-text)]">Status</span>
              {connected ? (
                <Badge tone="success">Connected</Badge>
              ) : (
                <Badge tone="neutral">Not connected</Badge>
              )}
            </CardRow>
            <CardBody className="p-[var(--space-4)]">
              <FormRow>
                <Field
                  label="Website address"
                  error={originError}
                  hint="The address of the site ClearPath built for you, with nothing after it."
                >
                  <Input
                    value={origin}
                    placeholder="https://yourbusiness.com"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      setTouched(true);
                      setOrigin(event.target.value);
                      setOriginError(undefined);
                    }}
                  />
                </Field>

                <Field
                  label="Token"
                  error={tokenError}
                  hint={
                    hasToken
                      ? "A token is already saved. Leave this empty to keep it, or paste a new one to replace it."
                      : "Copy it from your site's admin page. It goes into your Mac Keychain or Windows Credential Manager, never into your Helix file."
                  }
                >
                  <Input
                    type="password"
                    value={token}
                    placeholder={hasToken ? "Saved" : "Paste the token"}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      setToken(event.target.value);
                      setTokenError(undefined);
                    }}
                  />
                </Field>

                {addressChanged ? (
                  <Field
                    label="This address is"
                    hint="Helix keeps one place-in-the-list per address, so it has to be told which of these you mean."
                  >
                    <Select
                      value={addressChange}
                      onValueChange={(value) =>
                        setAddressChange(value as "same" | "different")
                      }
                      ariaLabel="This address is"
                      options={[
                        {
                          value: "same",
                          label: "The same website, at a new address",
                        },
                        { value: "different", label: "A different website" },
                      ]}
                    />
                  </Field>
                ) : null}

                <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                  <Button
                    variant="primary"
                    onClick={() => save.mutate()}
                    loading={save.isPending}
                    loadingLabel="Saving…"
                  >
                    Save
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => test.mutate()}
                    loading={test.isPending}
                    loadingLabel="Testing…"
                    disabled={!connected || unsavedEdits}
                    iconLeft={<Globe size={16} weight="bold" aria-hidden="true" />}
                  >
                    Test connection
                  </Button>
                </div>

                {connected && unsavedEdits ? (
                  <p
                    data-testid="site-test-needs-save"
                    className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
                  >
                    Save first. Test connection checks the address and token
                    Helix has saved, not what is typed above.
                  </p>
                ) : null}

                {testResult ? (
                  <p
                    role="status"
                    data-testid="site-test-result"
                    className={[
                      "text-[length:var(--text-sm)]",
                      testResult.ok
                        ? "text-[var(--color-success-ink)]"
                        : "text-[var(--color-danger-ink)]",
                    ].join(" ")}
                  >
                    {testResult.message}
                  </p>
                ) : null}
              </FormRow>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-[var(--space-3)]">
          <div>
            <CardGroupLabel>Checking for leads</CardGroupLabel>
            {/* The schedule is a constant, not a reading, and it was sitting in
                the table as though it were one - so the two rows that DO change
                had to compete with a sentence that never does, and at 1024 its
                label wrapped to "How / often" while its value wrapped to two
                lines of its own. It reads as what it is now: one quiet line
                under the group label, leaving the card to carry the status. */}
            <p className="pb-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              Every {POLL_MINUTES} minutes while Helix is open, and once when it starts.
            </p>
            <Card>
              <CardRow>
                <span className="text-[var(--color-text-muted)]">Last checked</span>
                <span
                  data-testid="site-last-polled"
                  className="tabular-nums text-[var(--color-text)]"
                >
                  {lastPolledAt ? formats.dateTime(lastPolledAt) : "Not yet"}
                </span>
              </CardRow>
              <CardRow>
                <span className="text-[var(--color-text-muted)]">Last result</span>
                <span className="text-right text-[var(--color-text)]">
                  {lastError ? (
                    /* `lead_sync.last_error` is stored in Helix's own words
                       ("LeadPollAuthError: HTTP 401") because Diagnostics and
                       support read it raw. It used to be printed here exactly
                       as stored, so an owner whose token had been rotated read
                       an exception class name on his own screen (LR-REV,
                       F-REV-4). He reads the sentence; the stored line stays
                       underneath in muted type, which is what Walker asks for
                       over the phone. */
                    <span className="flex flex-col items-end gap-[var(--space-1)]">
                      <span
                        data-testid="site-last-error"
                        className="text-[var(--color-danger-ink)]"
                      >
                        {describeStoredPollError(lastError)}
                      </span>
                      {storedPollErrorDetail(lastError) ? (
                        <span
                          data-testid="site-last-error-detail"
                          className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]"
                        >
                          {storedPollErrorDetail(lastError)}
                        </span>
                      ) : null}
                    </span>
                  ) : lastPolledAt ? (
                    "Everything came through."
                  ) : (
                    "Nothing to report yet."
                  )}
                </span>
              </CardRow>
            </Card>
          </div>
          <div className="px-[var(--space-1)]">
            <Button
              variant="secondary"
              onClick={() => pollNow.mutate()}
              loading={pollNow.isPending}
              loadingLabel="Checking…"
              disabled={!connected}
              iconLeft={<ArrowsClockwise size={16} weight="bold" aria-hidden="true" />}
            >
              Poll now
            </Button>
          </div>
        </div>

        <div>
          <CardGroupLabel>Disconnect</CardGroupLabel>
          <Card>
            <CardRow className="gap-[var(--space-5)] py-[var(--space-3)]">
              <span className="min-w-0 text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Helix stops checking your site and forgets the address and the token. Every
                contact and deal that already came in stays exactly where it is.
              </span>
              <Button
                variant="destructive"
                disabled={!connection.data?.siteOrigin}
                onClick={() => setConfirmingDisconnect(true)}
                iconLeft={<LinkBreak size={16} weight="bold" aria-hidden="true" />}
              >
                Disconnect
              </Button>
            </CardRow>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDisconnect}
        onOpenChange={setConfirmingDisconnect}
        title="Disconnect your website?"
        description="Helix will stop checking it for new leads. Nothing already in Helix is deleted."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => disconnect.mutate()}
      />
    </div>
  );
}

/** Turn whatever `leads_fetch` rejected with into one sentence. */
function describeFetchError(err: unknown): string {
  const status = statusFromError(err);
  if (isAuthStatus(status)) {
    return "Your website turned the token down. Check that you copied all of it.";
  }
  if (status === 404) {
    // Not "try again in a minute": a 404 is a site deployed without the lead
    // endpoint, and no amount of waiting changes that (LR-REV, F-REV-1).
    return "Your website has no lead connection on it yet. Ask ClearPath to switch it on.";
  }
  if (status === 400) {
    return "Your website could not read where Helix left off. Press Poll now; Helix will start again from your first lead.";
  }
  if (status !== null) {
    return `Your website answered with an error (${status}). Try again in a minute.`;
  }
  return `Helix could not reach your website. ${messageFrom(err)}`;
}

export default SiteConnectionScreen;
