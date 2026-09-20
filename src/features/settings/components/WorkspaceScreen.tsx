/**
 * Workspace: the business name, and the three formatting choices everything
 * else reads — currency, locale and the phone region.
 *
 * Two grouped inset lists, label on the left and control on the right, with the
 * sample value as the row's own second line: "A deal worth 12,450 reads
 * $12,450.00" sits under "Currency" rather than in a paragraph somewhere else,
 * which is how a native settings pane explains a pop-up menu.
 *
 * The name is written twice on purpose: to the workspace's own settings table
 * (what the screens read) and to helix.json (what the workspace list reads
 * while the file is closed). Both are in the plan's item 19.
 *
 * A third group appears only on a workspace that took "Show me an example"
 * during setup: the one button that takes the example back out again. The
 * onboarding feature owns the button and the confirm behind it; this screen
 * only decides that here is where the owner will look for it.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select, Textarea, toast } from "@/ui";
import * as settingsRepo from "@/db/repos/settings";
import { readRegistry, updateRegistry } from "@/app/appSettings";
import { formatMoney } from "@/lib/money";
import { formatDateDisplay } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { RemoveSampleDataButton, useHasSampleData } from "@/features/onboarding";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsRow,
  SettingsScreenFrame,
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

// The sample date used to be part of each label, which ran the pop-up button
// past its own width; the row's hint says what the choice reads like instead.
const LOCALES = [
  { value: "en-US", label: "English (United States)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-AU", label: "English (Australia)" },
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
  const [address, setAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  // Read before the loading branch below, because it is a hook.
  const hasSampleData = useHasSampleData();

  useEffect(() => {
    if (data) setName(data.workspaceName);
  }, [data]);

  useEffect(() => {
    if (data) {
      setAddress(data["business.address"]);
      setTaxId(data["business.taxId"]);
    }
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

  /** The two invoice-header fields, saved the moment the owner leaves the field. */
  async function saveBusinessField(
    key: "business.address" | "business.taxId",
    value: string,
    current: string,
    said: string,
  ) {
    const trimmed = value.trim();
    if (trimmed === current) return;
    await settingsRepo.set(key, trimmed);
    await refresh();
    toast.success(said);
  }

  if (isLoading || !data) {
    return (
      <SettingsScreenFrame title="Workspace" testId="settings-workspace">
        <SettingsLoading>Reading your settings…</SettingsLoading>
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
      actions={
        <Button
          variant="primary"
          onClick={() => void saveName()}
          loading={saving}
          loadingLabel="Saving…"
          data-testid="workspace-name-save"
        >
          Save name
        </Button>
      }
    >
      <SettingsGroup
        label="Business"
        footnote="The name shows at the bottom of the sidebar and in the workspace list."
      >
        <SettingsRow
          label="Name"
          htmlFor="workspace-name"
          field
          hint={
            nameError ? (
              <span role="alert" className="text-[var(--color-danger-ink)]">
                {nameError}
              </span>
            ) : undefined
          }
        >
          <Input
            id="workspace-name"
            value={name}
            invalid={Boolean(nameError)}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
            }}
            placeholder="Sorensen Landscaping"
            data-testid="workspace-name-input"
          />
        </SettingsRow>
        <SettingsRow label="Address" htmlFor="workspace-address" field>
          <Textarea
            id="workspace-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() =>
              void saveBusinessField(
                "business.address",
                address,
                data["business.address"],
                "Saved your address",
              )
            }
            placeholder={"123 Main Street\nProvo, UT 84601"}
            data-testid="workspace-address-input"
          />
        </SettingsRow>
        <SettingsRow
          label="Tax ID"
          htmlFor="workspace-tax-id"
          field
          hint="These print at the top of every invoice and quote."
        >
          <Input
            id="workspace-tax-id"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            onBlur={() =>
              void saveBusinessField(
                "business.taxId",
                taxId,
                data["business.taxId"],
                "Saved your tax ID",
              )
            }
            placeholder="87-1234567"
            data-testid="workspace-tax-id-input"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        label="Formats"
        footnote="Used everywhere a price, a date or a phone number is shown."
      >
        <SettingsRow
          label="Currency"
          hint={`A deal worth 12,450 reads ${sampleMoney}.`}
          field
        >
          <Select
            value={data.currency}
            onValueChange={(value) =>
              void saveKey("currency", value, `Money now shows in ${value}`)
            }
            options={CURRENCIES}
            ariaLabel="Currency"
          />
        </SettingsRow>
        <SettingsRow
          label="Date and number format"
          hint={`14 March 2026 reads ${sampleDate}.`}
          field
        >
          <Select
            value={data.locale}
            onValueChange={(value) => void saveKey("locale", value, "Date format saved")}
            options={LOCALES}
            ariaLabel="Date and number format"
          />
        </SettingsRow>
        <SettingsRow
          label="Phone region"
          hint={`A number typed as (801) 555-0147 is stored as ${samplePhone}.`}
          field
        >
          <Select
            value={data.defaultRegion}
            onValueChange={(value) => void saveKey("defaultRegion", value, "Phone region saved")}
            options={REGIONS}
            ariaLabel="Default phone region"
          />
        </SettingsRow>
      </SettingsGroup>

      {hasSampleData ? (
        <SettingsGroup
          label="Sample data"
          footnote="Everything you added yourself stays where it is."
        >
          <SettingsRow
            label="Example customers and jobs"
            hint="Helix put these in so the screens had something on them."
            field
          >
            <RemoveSampleDataButton size="sm" />
          </SettingsRow>
        </SettingsGroup>
      ) : null}
    </SettingsScreenFrame>
  );
}
