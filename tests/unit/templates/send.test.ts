/**
 * The links a template is handed to the OS through.
 *
 * Two things can silently ruin a templated message and neither shows up in a
 * screenshot: the wrong separator before `body` (Messages ignores the message
 * entirely on one platform) and `+` instead of `%20` for a space (the customer
 * reads "Hi+Nella"). Both are pinned here.
 */
import { describe, expect, it } from "vitest";
import { mailtoHref, smsHref } from "@/lib/actions";
import { renderTemplate } from "@/features/templates/lib/merge";

describe("smsHref", () => {
  it("is the bare number with no message", () => {
    expect(smsHref("(801) 555-0147")).toBe("sms:8015550147");
    expect(smsHref("+1 801 555 0147")).toBe("sms:+18015550147");
  });

  it("uses the ?&body= form that works on macOS, iOS and Android", () => {
    expect(smsHref("8015550147", { body: "On my way" })).toBe(
      "sms:8015550147?&body=On%20my%20way",
    );
  });

  it("percent-encodes a space rather than turning it into a plus", () => {
    const href = smsHref("8015550147", { body: "Hi Nella" });
    expect(href).toContain("%20");
    expect(href).not.toContain("+body");
    expect(href).not.toMatch(/body=Hi\+Nella/);
  });

  it("ignores an empty or whitespace-only body", () => {
    expect(smsHref("8015550147", { body: "" })).toBe("sms:8015550147");
    expect(smsHref("8015550147", { body: "   " })).toBe("sms:8015550147");
  });

  it("survives a body full of the characters a URL cares about", () => {
    const body = "Quote #4: $6,780.00 & up (30% deposit)\nDale";
    const href = smsHref("8015550147", { body });
    const encoded = href.slice(href.indexOf("?&body=") + "?&body=".length);
    expect(decodeURIComponent(encoded)).toBe(body);
  });
});

describe("mailtoHref", () => {
  it("carries the subject and the body, both percent-encoded", () => {
    const href = mailtoHref("nella@example.com", {
      subject: "Your quote from Alpine Ridge Landscape",
      body: "Hi Nella,\n\nThanks for having me out.",
    });
    expect(href.startsWith("mailto:nella%40example.com?")).toBe(true);
    expect(href).toContain("subject=Your%20quote%20from%20Alpine%20Ridge%20Landscape");
    expect(href).toContain("body=Hi%20Nella%2C%0A%0AThanks%20for%20having%20me%20out.");
    expect(href).not.toContain("+");
  });

  it("leaves out a parameter that was not given", () => {
    expect(mailtoHref("nella@example.com", { body: "Hello" })).toBe(
      "mailto:nella%40example.com?body=Hello",
    );
    expect(mailtoHref("nella@example.com")).toBe("mailto:nella%40example.com");
  });

  it("round-trips a rendered template exactly", () => {
    const body = renderTemplate(
      "Hi {{first_name}},\n\nThe quote for {{deal_title}} comes to {{deal_value}}.\n\n{{owner_name}}",
      {
        first_name: "Nella",
        deal_title: "Fall cleanup, 32 units",
        deal_value: "$6,780.00",
        owner_name: "Dale",
      },
    );
    const href = mailtoHref("nella@example.com", { body });
    const encoded = href.slice(href.indexOf("body=") + "body=".length);
    expect(decodeURIComponent(encoded)).toBe(body);
    expect(body).toContain("Fall cleanup, 32 units");
  });
});
