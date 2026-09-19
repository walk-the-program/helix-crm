/**
 * Workspace: the business name, and the three formatting choices everything
 * else reads - currency, locale and the phone region.
 *
 * The name is written twice on purpose: to the workspace's own settings table
 * (what the screens read) and to helix.json (what the workspace list reads
 * while the file is closed). Both are in the plan's item 19.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, FormRow, Input, Select, toast } from "@/ui";
import * as settingsRepo from "@/db/repos/settings";
import { readRegistry, updateRegistry } from "@/app/appSettings";
import { formatMoney } from "@/lib/money";
import { formatDateDisplay } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import {
  SettingsScreenFrame,
  SettingsBlock,
} from "@/features/settings/components/SettingsLayout";
import {
  refetchRegistry,
  settingsKeys,
  useWorkspaceSettings,
} from "@/features/settings/lib/queries";

/** The currencies a US or Canadian trade business actually invoices in. */
const CURRENCIES = [
  { value: "USD", label: "US dollar (USD)" },
  { value: "CAD", label: "Canadian dollar (CAD)" },
  { value: "GBP", label: "Pound sterling (GBP)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "AUD", label: "Australian dollar (AUD)" },
  { value: "NZD", label: "New Zealand dollar (NZD)" },
];

const LOCALES = [
  { value: "en-US", label: "English (United States) — 3/14/2026" },
  { value: "en-CA", label: "English (Canada) — 2026-03-14" },
  { value: "en-GB", label: "English (United Kingdom) — 14/03/2026" },
  { value: "en-AU", label: "English (Australia) — 14/03/2026" },
];

const REGIONS = [
  { value: "US", label: "United States (+1)" },
  { value: "CA", label: "Canada (+1)" },
  { value: "GB", label: "United Kingdom (+44)" },
  { value: "AU", label: "Australia (+61)" },
  { value: "NZ", label: "New Zealand (+64)" },
];

const SAMPLE_PHONE = "8015550147";

export function WorkspaceScreen() {
  const client = useQueryClient();
  const { data, isLoading } = useWorkspaceSettings();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setName(data.workspaceName);
  }, [data]);

  async function refresh() {
    await client.invalidateQueries({ queryKey: settingsKeys.all() });
    await client.invalidateQueries({ queryKey: ["setting"] });
    await refetchRegistry(client);
  }

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError("Give this workspace a name so you can tell it from the others.");
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      await settingsRepo.set("workspaceName", trimmed);
      const registry = await readRegistry();
      const openId = registry.lastOpened;
      if (openId) {
        await updateRegistry((current) => ({
          ...current,
          workspaces: current.workspaces.map((w) =>
            w.id === openId ? { ...w, name: trimmed } : w,
          ),
        }));
      }
      await refresh();
      toast.success(`Renamed this workspace to ${trimmed}`);
    } finally {
      setSaving(false);
    }
  }

  /** The three format keys are all plain strings in the repository's registry. */
  async function saveKey(
    key: "currency" | "locale" | "defaultRegion",
    value: string,
    said: string,
  ) {
    if (key === "currency") await settingsRepo.set("currency", value);
    else if (key === "locale") await settingsRepo.set("locale", value);
    else await settingsRepo.set("defaultRegion", value);
    await refresh();
    toast.success(said);
  }

  if (isLoading || !data) {
    // A quiet line, not a spinner: DESIGN.md s8 wants loading to be stated, not
    // animated, and a bare spinner on an empty panel reads as a broken screen.
    return (
      <SettingsScreenFrame title="Workspace" testId="settings-workspace">
        <p
          className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          role="status"
        >
          Reading your settings…
        </p>
      </SettingsScreenFrame>
    );
  }

  const sampleMoney = formatMoney(1245000, data.currency, data.locale);
  const sampleDate = formatDateDisplay("2026-03-14", data.locale);
  const samplePhone =
    normalizePhone(SAMPLE_PHONE, data.defaultRegion).e164 ?? SAMPLE_PHONE;

  return (
    <SettingsScreenFrame
      title="Workspace"
      subtitle="The business this file belongs to, and how numbers and dates are written."
      testId="settings-workspace"
    >
      <SettingsBlock
        title="Business name"
        description="It shows at the bottom of the sidebar and in the workspace list."
      >
        <FormRow>
          <Field label="Name" error={nameError ?? undefined}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sorensen Landscaping"
              data-testid="workspace-name-input"
            />
          </Field>
          <div>
            <Button
              variant="primary"
              onClick={() => void saveName()}
              loading={saving}
              data-testid="workspace-name-save"
            >
              Save name
            </Button>
          </div>
        </FormRow>
      </SettingsBlock>

      <SettingsBlock
        title="Money and dates"
        description="Used everywhere a price, a date or a phone number is shown."
      >
        <FormRow>
          <Field label="Currency" hint={`A deal worth 12,450 reads ${sampleMoney}.`}>
            <Select
              value={data.currency}
              onValueChange={(value) =>
                void saveKey("currency", value, `Money now shows in ${value}`)
              }
              options={CURRENCIES}
              ariaLabel="Currency"
            />
          </Field>
          <Field
            label="Date and number format"
            hint={`14 March 2026 reads ${sampleDate}.`}
          >
            <Select
              value={data.locale}
              onValueChange={(value) =>
                void saveKey("locale", value, "Date format saved")
              }
              options={LOCALES}
              ariaLabel="Date and number format"
            />
          </Field>
          <Field
            label="Default phone region"
            hint={`A number typed as (801) 555-0147 is stored as ${samplePhone}.`}
          >
            <Select
              value={data.defaultRegion}
              onValueChange={(value) =>
                void saveKey("defaultRegion", value, "Phone region saved")
              }
              options={REGIONS}
              ariaLabel="Default phone region"
            />
          </Field>
        </FormRow>
      </SettingsBlock>
    </SettingsScreenFrame>
  );
}
