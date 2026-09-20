/**
 * Settings > AI.
 *
 * Off by default, the owner's own key, and nothing running in the background.
 * The screen says all three in plain words, because the audience's reasonable
 * first question about an AI feature is "what is it sending, and when".
 *
 * Four grouped inset lists in the System Settings idiom: the switch, the key,
 * the model, and a plain-language account of what leaves the machine. "Save
 * key" is the screen's one primary button and its one block of brand primary;
 * Test key is secondary and Remove key is the destructive text button. None of
 * the three carries a glyph - each label is already the shortest true sentence,
 * and three glyphs in a row is noise.
 *
 * The key field is write-only. It is handed straight to the keychain through
 * secret_set and never read back; all the screen keeps is the last four
 * characters so it can say "saved, ends in 1234".
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, CardRow, Input, Select, Switch, toast } from "@/ui";
import { cn } from "@/ui/cn";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsRow,
  SettingsScreenFrame,
  SettingsValueRow,
} from "@/features/settings/components/SettingsLayout";
import { AI_MODELS } from "@/features/ai/lib/models";
import {
  describeStoredKey,
  forgetKey,
  readAiConfig,
  recordSavedKey,
  setEnabled,
  setModel,
} from "@/features/ai/lib/aiSettings";
import { deleteSecret, KeychainError, setSecret } from "@/features/ai/lib/secrets";
import { aiErrorMessage } from "@/features/ai/errors";
import { aiQueryKeys, runWithProvider, useWorkspaceId } from "@/features/ai/lib/useAi";

export function AiSettingsScreen() {
  const client = useQueryClient();
  const workspace = useWorkspaceId();
  const workspaceId = workspace.data ?? null;

  const config = useQuery({
    queryKey: aiQueryKeys.config(),
    queryFn: readAiConfig,
    staleTime: 0,
  });

  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; message: string } | null
  >(null);

  async function refresh() {
    await client.invalidateQueries({ queryKey: ["ai"] });
    await client.invalidateQueries({ queryKey: ["setting"] });
    await client.invalidateQueries({ queryKey: ["settings"] });
  }

  async function onToggle(next: boolean) {
    await setEnabled(next);
    await refresh();
    toast.success(next ? "AI is on" : "AI is off");
  }

  async function onSaveKey() {
    const key = keyInput.trim();
    if (key.length === 0) {
      setKeyError("Paste the key from your Anthropic console first.");
      return;
    }
    if (!workspaceId) {
      setKeyError("No workspace is open yet.");
      return;
    }
    setKeyError(null);
    setSaving(true);
    try {
      await setSecret(workspaceId, "anthropic", key);
      await recordSavedKey(key);
      setKeyInput("");
      setTestResult(null);
      await refresh();
      toast.success("Saved the key to your keychain");
    } catch (err) {
      if (err instanceof KeychainError) {
        // PLAN.md's KeychainError row: say it plainly, and leave AI off.
        await setEnabled(false);
        await refresh();
        setKeyError(`${err.message} AI stays off; nothing was written anywhere else.`);
        return;
      }
      setKeyError(aiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onForgetKey() {
    if (!workspaceId) return;
    try {
      await deleteSecret(workspaceId, "anthropic");
    } catch {
      // A keychain that will not answer is already reported elsewhere.
    }
    await forgetKey();
    await setEnabled(false);
    await refresh();
    toast.success("Removed the key and turned AI off");
  }

  async function onTestKey() {
    if (!workspaceId || !config.data) return;
    setTesting(true);
    setTestResult(null);
    try {
      await runWithProvider(workspaceId, config.data, (provider) => provider.testKey());
      setTestResult({ ok: true });
      await refresh();
    } catch (err) {
      setTestResult({ ok: false, message: aiErrorMessage(err) });
      await refresh();
    } finally {
      setTesting(false);
    }
  }

  if (config.isLoading || !config.data) {
    return (
      <SettingsScreenFrame title="AI" testId="settings-ai">
        <SettingsLoading>Reading your AI settings…</SettingsLoading>
      </SettingsScreenFrame>
    );
  }

  const data = config.data;
  const hasKey = data.keyState !== "unset";
  const modelNote = AI_MODELS.find((m) => m.id === data.model)?.note;

  return (
    <SettingsScreenFrame
      title="AI"
      subtitle="Optional, off by default, and paid for with your own Anthropic key."
      testId="settings-ai"
    >
      {/* No label on the first group: the page title already says AI, and a
          macOS pane leads with an unlabelled group rather than repeating
          itself. */}
      <SettingsGroup
        footnote="Turn it on and three buttons appear: paste an email and get a customer and a job to check, draft a follow-up from a job's history, and summarise a record."
      >
        <SettingsRow
          label={<span data-testid="ai-enabled-label">{data.enabled ? "AI is on" : "AI is off"}</span>}
          htmlFor="ai-enabled"
          className="border-b-0"
        >
          <Switch
            checked={data.enabled}
            onCheckedChange={(next) => void onToggle(next)}
            id="ai-enabled"
            ariaLabel="AI is on"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        label="Your Anthropic key"
        footnote="It goes into your Mac Keychain or Windows Credential Manager. It is never written to the database, to helix.json, or to the log."
      >
        <SettingsRow label="Key">
          <span
            className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
            data-testid="ai-key-state"
          >
            {describeStoredKey(data.keyState, data.keySuffix)}
            {data.keyState === "rejected" ? <Badge tone="danger">Rejected</Badge> : null}
          </span>
        </SettingsRow>

        <SettingsRow
          label={hasKey ? "Replace the key" : "API key"}
          htmlFor="ai-key-input"
          field
          hint={
            keyError ? (
              <span role="alert" className="text-[var(--color-danger-ink)]">
                {keyError}
              </span>
            ) : (
              "Starts with sk-ant-. Create one at console.anthropic.com."
            )
          }
        >
          <Input
            id="ai-key-input"
            type="password"
            value={keyInput}
            invalid={Boolean(keyError)}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setKeyInput(e.target.value);
              if (keyError) setKeyError(null);
            }}
            placeholder="sk-ant-..."
            data-testid="ai-key-input"
          />
        </SettingsRow>

        {testResult ? (
          <CardRow>
            <span
              role="status"
              data-testid="ai-test-result"
              className={cn(
                "text-[length:var(--text-sm)]",
                testResult.ok
                  ? "text-[var(--color-success-ink)]"
                  : "text-[var(--color-danger-ink)]",
              )}
            >
              {testResult.ok ? "That key works. Anthropic answered." : testResult.message}
            </span>
          </CardRow>
        ) : null}

        <CardRow className="justify-end border-b-0">
          {hasKey ? (
            <Button
              variant="destructive"
              onClick={() => void onForgetKey()}
              data-testid="ai-key-forget"
            >
              Remove key
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => void onTestKey()}
            loading={testing}
            loadingLabel="Testing…"
            disabled={!hasKey}
            data-testid="ai-key-test"
          >
            Test key
          </Button>
          <Button
            variant="primary"
            onClick={() => void onSaveKey()}
            loading={saving}
            loadingLabel="Saving…"
            data-testid="ai-key-save"
          >
            Save key
          </Button>
        </CardRow>
      </SettingsGroup>

      <SettingsGroup label="Model" footnote={modelNote}>
        <SettingsRow
          label="Model"
          hint="All three read the same text. The difference is accuracy on messy notes, and what it costs you."
          field
          className="border-b-0"
        >
          <Select
            value={data.model}
            onValueChange={(value) => {
              void setModel(value).then(refresh);
            }}
            options={AI_MODELS.map((m) => ({ value: m.id, label: m.label }))}
            ariaLabel="Model"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="What gets sent, and when">
        <SettingsValueRow label="Only on a button">
          Nothing is sent unless you press one of the three AI buttons. There is no
          background AI, no scheduled call, and nothing runs while Helix sits open.
        </SettingsValueRow>
        <SettingsValueRow label="Only what is on screen">
          One record and its timeline, or the text you pasted. Never your contact list,
          never another customer, never the whole database.
        </SettingsValueRow>
        <SettingsValueRow label="Nothing saves itself">
          What comes back is shown to you first. Nothing is written to your data until
          you press Save.
        </SettingsValueRow>
        <SettingsValueRow label="Where it goes">
          Straight to Anthropic&apos;s API from your machine. Helix has no server, so no
          request passes through us.
        </SettingsValueRow>
        <SettingsValueRow label="Who pays for it">
          Anthropic bills the key above, so the cost is yours and it appears on your
          own Anthropic account. Helix and ClearPath never charge for it and never see
          it. Anthropic publishes what each model costs; these three are priced in
          that order, cheapest first: Haiku, Sonnet, Opus.
        </SettingsValueRow>
      </SettingsGroup>
    </SettingsScreenFrame>
  );
}
