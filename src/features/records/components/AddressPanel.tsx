/**
 * The address block: six inline fields that autosave as one JSON value, and a
 * one-tap "Directions" that hands the whole address to the OS map handler and
 * then offers to log the lookup.
 */
import { MapPin } from "lucide-react";
import { Button } from "@/ui";
import { InlineText } from "@/features/records/components/InlineEdit";
import {
  formatAddressOneLine,
  mapsUrl,
  parseAddress,
  stringifyAddress,
  type Address,
} from "@/features/records/lib/address";
import { oneTap, type RecordLink } from "@/features/records/lib/oneTap";

export function AddressPanel(props: {
  addressJson: string | null;
  onSave: (json: string | null) => Promise<void>;
  link: RecordLink;
}) {
  const address = parseAddress(props.addressJson);
  const href = mapsUrl(address);

  function saveField(key: keyof Address) {
    return async (value: string) => {
      const next: Address = { ...address, [key]: value };
      await props.onSave(stringifyAddress(next));
    };
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="grid grid-cols-2 gap-[var(--space-4)]">
        <InlineText
          className="col-span-2"
          label="Street"
          value={address.line1}
          placeholder="1420 S Main St"
          onSave={saveField("line1")}
        />
        <InlineText
          className="col-span-2"
          label="Unit or suite"
          value={address.line2}
          placeholder="Suite 4"
          onSave={saveField("line2")}
        />
        <InlineText label="City" value={address.city} placeholder="Sandy" onSave={saveField("city")} />
        <InlineText label="State" value={address.region} placeholder="UT" onSave={saveField("region")} />
        <InlineText label="ZIP" value={address.postal} placeholder="84070" onSave={saveField("postal")} />
        <InlineText
          label="Country"
          value={address.country}
          placeholder="United States"
          onSave={saveField("country")}
        />
      </div>

      {href ? (
        <div>
          <Button
            variant="secondary"
            iconLeft={<MapPin size={20} aria-hidden="true" />}
            className="min-h-[44px]"
            onClick={() =>
              void oneTap("map", formatAddressOneLine(address), props.link, {
                href,
                label: formatAddressOneLine(address),
              })
            }
          >
            Directions
          </Button>
        </div>
      ) : null}
    </div>
  );
}
