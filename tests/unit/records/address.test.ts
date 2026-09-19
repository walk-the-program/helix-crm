import { describe, expect, it } from "vitest";
import {
  EMPTY_ADDRESS,
  formatAddressLines,
  formatAddressOneLine,
  isEmptyAddress,
  mapsUrl,
  parseAddress,
  stringifyAddress,
  type Address,
} from "@/features/records/lib/address";

const utah: Address = {
  line1: "1420 S Main St",
  line2: "Suite 4",
  city: "Sandy",
  region: "UT",
  postal: "84070",
  country: "",
};

describe("parseAddress", () => {
  it("reads the object it wrote", () => {
    const json = stringifyAddress(utah);
    expect(parseAddress(json)).toEqual(utah);
  });

  it("treats null, empty and whitespace as no address", () => {
    expect(parseAddress(null)).toEqual(EMPTY_ADDRESS);
    expect(parseAddress("")).toEqual(EMPTY_ADDRESS);
    expect(parseAddress("   ")).toEqual(EMPTY_ADDRESS);
  });

  it("degrades a plain string into the first line instead of throwing", () => {
    expect(parseAddress("1420 S Main St").line1).toBe("1420 S Main St");
    expect(parseAddress('"1420 S Main St"').line1).toBe("1420 S Main St");
  });

  it("accepts the aliases an import might have written", () => {
    const parsed = parseAddress(
      JSON.stringify({ street: "9 Elm", address2: "Apt 2", town: "Provo", state: "UT", zip: "84601" }),
    );
    expect(parsed.line1).toBe("9 Elm");
    expect(parsed.line2).toBe("Apt 2");
    expect(parsed.city).toBe("Provo");
    expect(parsed.region).toBe("UT");
    expect(parsed.postal).toBe("84601");
  });

  it("ignores a JSON value that is not an object", () => {
    expect(parseAddress("42")).toEqual(EMPTY_ADDRESS);
    expect(parseAddress("null")).toEqual(EMPTY_ADDRESS);
  });
});

describe("stringifyAddress", () => {
  it("stores NULL rather than an empty object", () => {
    expect(stringifyAddress(EMPTY_ADDRESS)).toBeNull();
    expect(stringifyAddress({ ...EMPTY_ADDRESS, city: "   " })).toBeNull();
  });

  it("drops blank fields and trims the rest", () => {
    const json = stringifyAddress({ ...EMPTY_ADDRESS, line1: "  9 Elm  ", city: "" });
    expect(json).not.toBeNull();
    expect(JSON.parse(json as string)).toEqual({ line1: "9 Elm" });
  });
});

describe("isEmptyAddress", () => {
  it("is true only when every field is blank", () => {
    expect(isEmptyAddress(EMPTY_ADDRESS)).toBe(true);
    expect(isEmptyAddress(utah)).toBe(false);
  });
});

describe("formatAddressLines", () => {
  it("puts city, region and postal on one line", () => {
    expect(formatAddressLines(utah)).toEqual(["1420 S Main St", "Suite 4", "Sandy, UT 84070"]);
  });

  it("copes with a city and no region or postal", () => {
    expect(formatAddressLines({ ...EMPTY_ADDRESS, city: "Sandy" })).toEqual(["Sandy"]);
  });

  it("copes with a region and no city", () => {
    expect(formatAddressLines({ ...EMPTY_ADDRESS, region: "UT", postal: "84070" })).toEqual([
      "UT 84070",
    ]);
  });

  it("returns nothing for an empty address", () => {
    expect(formatAddressLines(EMPTY_ADDRESS)).toEqual([]);
    expect(formatAddressOneLine(EMPTY_ADDRESS)).toBe("");
  });
});

describe("mapsUrl", () => {
  it("encodes the whole address as a query", () => {
    expect(mapsUrl(utah)).toBe(
      "https://maps.apple.com/?q=1420%20S%20Main%20St%2C%20Suite%204%2C%20Sandy%2C%20UT%2084070",
    );
  });

  it("returns null when there is nothing to look up", () => {
    expect(mapsUrl(EMPTY_ADDRESS)).toBeNull();
  });
});
