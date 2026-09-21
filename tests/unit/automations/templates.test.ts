import { describe, expect, it } from "vitest";
import { dueInPhrase, renderTemplate } from "@/db/repos/automations";

describe("automations: renderTemplate", () => {
  it("substitutes all three tokens", () => {
    const out = renderTemplate("Follow up on quote {number} with {name} about {job}", {
      name: "Dana Reyes",
      number: "QUO-0007",
      job: "Kitchen rewire",
    });
    expect(out).toBe("Follow up on quote QUO-0007 with Dana Reyes about Kitchen rewire");
  });

  it("leaves a token it does not know about alone", () => {
    const out = renderTemplate("Call {name} about {something}", { name: "Dana Reyes" });
    expect(out).toBe("Call Dana Reyes about {something}");
  });

  // The token still renders as nothing, which is what these two are about.
  // What changed with F-SEC-R-1 is the gap it leaves behind: renderTemplate now
  // collapses whitespace on the way out, so the owner reads "Call about their
  // request" rather than a title with a hole in the middle of it. The double
  // space was never intended, it was just what string replacement produced.
  it("renders a null value as an empty string", () => {
    const out = renderTemplate("Call {name} about their request", { name: null });
    expect(out).toBe("Call about their request");
  });

  it("renders an omitted (undefined) known token as an empty string", () => {
    const out = renderTemplate("Call {name} about their request", {});
    expect(out).toBe("Call about their request");
  });

  it("returns a template with no tokens unchanged", () => {
    const out = renderTemplate("Call after the walkthrough", { name: "Dana Reyes" });
    expect(out).toBe("Call after the walkthrough");
  });
});

describe("automations: dueInPhrase", () => {
  it("0 minutes is now", () => {
    expect(dueInPhrase(0)).toBe("now");
  });

  it("a negative delay is also now", () => {
    expect(dueInPhrase(-5)).toBe("now");
  });

  it("45 minutes", () => {
    expect(dueInPhrase(45)).toBe("in 45 minutes");
  });

  it("one minute is singular", () => {
    expect(dueInPhrase(1)).toBe("in 1 minute");
  });

  it("60 minutes is one hour", () => {
    expect(dueInPhrase(60)).toBe("in 1 hour");
  });

  it("180 minutes is three hours", () => {
    expect(dueInPhrase(180)).toBe("in 3 hours");
  });

  it("1440 minutes is one day", () => {
    expect(dueInPhrase(1440)).toBe("in 1 day");
  });

  it("4320 minutes is three days", () => {
    expect(dueInPhrase(4320)).toBe("in 3 days");
  });
});
