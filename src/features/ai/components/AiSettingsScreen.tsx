/**
 * Settings > AI.
 *
 * Off by default, the owner's own key, and nothing running in the background.
 * The screen says all three in plain words, because the audience's reasonable
 * first question about an AI feature is "what is it sending, and when".
 *
 * The key field is write-only. It is handed straight to the keychain through
 * secret_set and never read back; all the screen keeps is the last four
 * characters so it can say "saved, ends in 1234".
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, KeyRound, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Field,
  FormRow,
  Input,
  Select,
  Switch,
  toast,
} from "@/ui";
import {
  SettingsScreenFrame,
  SettingsBlock,
  DataRow,
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
        <p
          className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          role="status"
        >
          Reading your AI settings…
        </p>
      </SettingsScreenFrame>
    );
  }

  const data = config.data;
  const hasKey = data.keyState !== "unset";

  return (
    <SettingsScreenFrame
      title="AI"
      subtitle="Optional, off by default, and paid for with your own Anthropic key."
      testId="settings-ai"
    >
      <SettingsBlock
        title="AI is off"
        description="Turn it on and three buttons appear: paste an email and get a contact and a job to check, draft a follow-up from a job's history, and summarise a record."
      >
        <div className="flex items-center gap-[var(--space-3)]">
          <Switch
            checked={data.enabled}
            onCheckedChange={(next) => void onToggle(next)}
            id="ai-enabled"
            ariaLabel="AI is on"
          />
          <label
            htmlFor="ai-enabled"
            className="text-[length:var(--text-base)] text-[var(--color-text)]"
            data-testid="ai-enabled-label"
          >
            {data.enabled ? "AI is on" : "AI is off"}
          </label>
        </div>
      </SettingsBlock>

      <SettingsBlock
        title="Your Anthropic key"
        description="It goes into your Mac Keychain or Windows Credential Manager. It is never written to the database, to helix.json, or to the log."
      >
        <FormRow>
          <div
            className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
            data-testid="ai-key-state"
          >
            <KeyRound size={16} aria-hidden />
            {describeStoredKey(data.keyState, data.keySuffix)}
            {data.keyState === "rejected" ? (
              <Badge tone="danger">Rejected</Badge>
            ) : null}
          </div>

          <Field
            label={hasKey ? "Replace the key" : "API key"}
            error={keyError ?? undefined}
            hint="Starts with sk-ant-. Create one at console.anthropic.com."
          >
            <Input
              type="password"
              value={keyInput}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              data-testid="ai-key-input"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <Button
              variant="primary"
              onClick={() => void onSaveKey()}
              loading={saving}
              iconLeft={<Check size={16} aria-hidden />}
              data-testid="ai-key-save"
            >
              Save key
            </Button>
            <Button
              variant="secondary"
              onClick={() => void onTestKey()}
              loading={testing}
              disabled={!hasKey}
              iconLeft={<Eye size={16} aria-hidden />}
              data-testid="ai-key-test"
            >
              Test key
            </Button>
            {hasKey ? (
              <Button
                variant="secondary"
                onClick={() => void onForgetKey()}
                iconLeft={<Trash2 size={16} aria-hidden />}
                data-testid="ai-key-forget"
              >
                Remove key
              </Button>
            ) : null}
          </div>

          {testResult ? (
            <p
              role="status"
              data-testid="ai-test-result"
              className={[
                "text-[length:var(--text-sm)]",
                testResult.ok
                  ? "text-[var(--color-success-ink)]"
                  : "text-[var(--color-danger-ink)]",
              ].join(" ")}
            >
              {testResult.ok
                ? "That key works. Anthropic answered."
                : testResult.message}
            </p>
          ) : null}
        </FormRow>
      </SettingsBlock>

      <SettingsBlock
        title="Model"
        description="All three read the same text. The difference is accuracy on messy notes, and what it costs you."
      >
        <Field label="Model">
          <Select
            value={data.model}
            onValueChange={(value) => {
              void setModel(value).then(refresh);
            }}
            options={AI_MODELS.map((m) => ({ value: m.id, label: m.label }))}
            ariaLabel="Model"
          />
        </Field>
        <p className="mt-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {AI_MODELS.find((m) => m.id === data.model)?.note}
        </p>
      </SettingsBlock>

      <SettingsBlock title="What gets sent, and when">
        <DataRow label="Only on a button">
          Nothing is sent unless you press one of the three AI buttons. There is no
          background AI, no scheduled call, and nothing runs while Helix sits open.
        </DataRow>
        <DataRow label="Only what is on screen">
          One record and its timeline, or the text you pasted. Never your contact
          list, never another customer, never the whole database.
        </DataRow>
        <DataRow label="Nothing saves itself">
          What comes back is shown to you first. Nothing is written to your data
          until you press Confirm.
        </DataRow>
        <DataRow label="Where it goes">
          Straight to Anthropic&apos;s API from your machine. Helix has no server, so
          no request passes through us.
        </DataRow>
      </SettingsBlock>
    </SettingsScreenFrame>
  );
}
