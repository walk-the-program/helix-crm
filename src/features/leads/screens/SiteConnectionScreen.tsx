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
 * This screen is mounted by the settings feature at "/settings/site"; it is
 * also registered by the leads feature so the route works before that lands.
 */
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Link2Off, RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Field,
  FormRow,
  Input,
  PageHeader,
  toast,
} from "@/ui";
import * as leadSync from "@/db/repos/leadSync";
import { formatDateTimeDisplay } from "@/lib/dates";
import { PollBanner } from "@/features/leads/components/PollBanner";
import { usePollStatus, leadKeys } from "@/features/leads/hooks";
import {
  checkOrigin,
  disconnectSite,
  readSiteConnection,
  saveSiteOrigin,
  setSiteToken,
  syncKeyFor,
} from "@/features/leads/lib/siteConnection";
import { invokeLeadsFetch } from "@/features/leads/lib/leadsFetch";
import { POLL_INTERVAL_MS, refresh, tick } from "@/features/leads/poller";
import { statusFromError, isAuthStatus } from "@/features/leads/lib/backoff";

const POLL_MINUTES = POLL_INTERVAL_MS / 60_000;

type TestResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export function SiteConnectionScreen() {
  const queryClient = useQueryClient();
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
      const checked = checkOrigin(origin);
      if (!checked.ok) throw new Error(checked.message);
      await saveSiteOrigin(checked.origin);
      // An empty box means "leave the stored token alone", which is how the
      // owner changes only the address without retyping a 40-character key.
      if (token.trim().length > 0) await setSiteToken(token.trim());
      return checked.origin;
    },
    onSuccess: async () => {
      setToken("");
      setTestResult(null);
      setOriginError(undefined);
      toast.success("Website connection saved");
      await reloadAll();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setOriginError(message);
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
            ? `Connected. The oldest lead waiting is from ${formatDateTimeDisplay(page.leads[0].createdAt)}.`
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
      toast.success("Website disconnected. Your leads stay where they are.");
      await reloadAll();
    },
  });

  const connected = connection.data?.connected ?? false;
  const hasToken = connection.data?.hasToken ?? false;
  const lastPolledAt = sync.data?.lastPolledAt ?? status.lastPolledAt;
  const lastError = sync.data?.lastError ?? null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Website"
        subtitle="Leads from your ClearPath site land here on their own."
      />

      <div className="flex flex-col gap-[var(--space-5)] p-[var(--space-6)] max-w-[720px]">
        <PollBanner status={status} />

        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            {connected ? (
              <span className="text-[length:var(--text-sm)] text-[var(--color-success)]">
                Connected
              </span>
            ) : (
              <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Not connected
              </span>
            )}
          </CardHeader>
          <CardBody>
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
                hint={
                  hasToken
                    ? "A token is saved on this Mac. Leave this empty to keep it, or paste a new one to replace it."
                    : "Copy this from your site's admin page. It is kept in the Mac keychain, never in your Helix file."
                }
              >
                <Input
                  type="password"
                  value={token}
                  placeholder={hasToken ? "Saved" : "Paste the token"}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setToken(event.target.value)}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <Button
                  variant="primary"
                  onClick={() => save.mutate()}
                  loading={save.isPending}
                >
                  Save
                </Button>
                <Button
                  onClick={() => test.mutate()}
                  loading={test.isPending}
                  disabled={!connected}
                  iconLeft={<Globe size={16} aria-hidden="true" />}
                >
                  Test connection
                </Button>
              </div>

              {testResult ? (
                <p
                  role="status"
                  data-testid="site-test-result"
                  className={[
                    "text-[length:var(--text-sm)]",
                    testResult.ok
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-danger)]",
                  ].join(" ")}
                >
                  {testResult.message}
                </p>
              ) : null}
            </FormRow>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Checking for leads</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-[var(--space-6)] gap-y-[var(--space-2)]">
              <dt className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                How often
              </dt>
              <dd className="text-[length:var(--text-sm)] text-[var(--color-text)]">
                Every {POLL_MINUTES} minutes while Helix is open, and once when
                it starts.
              </dd>

              <dt className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Last checked
              </dt>
              <dd
                data-testid="site-last-polled"
                className="tabular text-[length:var(--text-sm)] text-[var(--color-text)]"
              >
                {lastPolledAt ? formatDateTimeDisplay(lastPolledAt) : "Not yet"}
              </dd>

              <dt className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Last result
              </dt>
              <dd className="text-[length:var(--text-sm)] text-[var(--color-text)]">
                {lastError ? (
                  <span className="text-[var(--color-danger)]">{lastError}</span>
                ) : lastPolledAt ? (
                  "Everything came through."
                ) : (
                  "Nothing to report yet."
                )}
              </dd>
            </dl>

            <div className="mt-[var(--space-4)]">
              <Button
                onClick={() => pollNow.mutate()}
                loading={pollNow.isPending}
                disabled={!connected}
                iconLeft={<RefreshCw size={16} aria-hidden="true" />}
              >
                Poll now
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Disconnect</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              Helix stops checking your site and forgets the address and the
              token. Every contact and deal that already came in stays exactly
              where it is.
            </p>
            <div className="mt-[var(--space-4)]">
              <Button
                variant="danger"
                disabled={!connection.data?.siteOrigin}
                onClick={() => setConfirmingDisconnect(true)}
                iconLeft={<Link2Off size={16} aria-hidden="true" />}
              >
                Disconnect
              </Button>
            </div>
          </CardBody>
        </Card>
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
  if (status !== null) {
    return `Your website answered with an error (${status}). Try again in a minute.`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `Helix could not reach your website. ${message}`;
}

export default SiteConnectionScreen;
