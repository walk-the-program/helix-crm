// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Field, Input } from "@/ui";

afterEach(() => {
  cleanup();
});

function renderField(props: {
  error?: string;
  hint?: string;
  required?: boolean;
  htmlFor?: string;
  inputId?: string;
}) {
  return render(
    React.createElement(Field, {
      label: "Email",
      error: props.error,
      hint: props.hint,
      required: props.required,
      htmlFor: props.htmlFor,
      children: React.createElement(Input, { id: props.inputId, type: "email" }),
    }),
  );
}

describe("Field", () => {
  it("links the error text through aria-describedby and gives it role=alert", () => {
    renderField({ error: "Enter a valid email address." });

    const input = screen.getByRole("textbox");
    const errorEl = screen.getByRole("alert");
    expect(errorEl.textContent).toContain("Enter a valid email address.");

    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy.split(" ")).toContain(errorEl.id);
  });

  it("sets aria-invalid when there is an error and omits it when there is not", () => {
    const { unmount } = renderField({ error: "Enter a valid email address." });
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    unmount();

    renderField({});
    expect(screen.getByRole("textbox").hasAttribute("aria-invalid")).toBe(false);
  });

  it("links the hint through aria-describedby", () => {
    renderField({ hint: "We only use this to send receipts." });

    const input = screen.getByRole("textbox");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy.length).toBeGreaterThan(0);

    const hintId = describedBy.split(" ")[0];
    const hintEl = document.getElementById(hintId);
    expect(hintEl?.textContent).toContain("We only use this to send receipts.");
  });

  it("marks a required field with the word Required and never an asterisk", () => {
    renderField({ required: true });

    expect(screen.getByText("Required")).toBeTruthy();
    const label = document.querySelector("label");
    expect(label?.textContent ?? "").not.toContain("*");
  });

  it("points the label's htmlFor at the control's id when no explicit id is passed", () => {
    renderField({});

    const input = screen.getByRole("textbox");
    const label = document.querySelector("label") as HTMLLabelElement;
    expect(label.htmlFor).toBe(input.id);
    expect(input.id.length).toBeGreaterThan(0);
  });
});
