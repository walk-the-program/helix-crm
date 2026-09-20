/**
 * LR-REV. What actually arrives in the Token box on Settings > Website.
 *
 * The token is handed to a client in a message, so the paste is routinely the
 * whole environment line, the value in quotes, or a value a mail client wrapped
 * across two lines. Every one of those used to be stored verbatim and then
 * rejected by the site as a wrong token, which sends the owner and Walker
 * looking for a rotation that never happened.
 */
import { describe, expect, it } from "vitest";
import { checkToken, cleanToken } from "../../../src/features/leads/lib/siteConnection";

const REAL = "m4Kb0Zq7t1sVX9rL2pYwN6uHdA8cJfE3gQiT5oRsB0k=";

describe("cleanToken", () => {
  it("leaves a correctly pasted token exactly as it is", () => {
    expect(cleanToken(REAL)).toBe(REAL);
  });

  it("drops the environment-variable name a client copied with it", () => {
    expect(cleanToken(`CRM_API_TOKEN=${REAL}`)).toBe(REAL);
    expect(cleanToken(`crm_api_token = ${REAL}`)).toBe(REAL);
  });

  it("drops one matching pair of surrounding quotes", () => {
    expect(cleanToken(`"${REAL}"`)).toBe(REAL);
    expect(cleanToken(`'${REAL}'`)).toBe(REAL);
    expect(cleanToken(`CRM_API_TOKEN="${REAL}"`)).toBe(REAL);
  });

  it("repairs a paste a mail client wrapped", () => {
    expect(cleanToken(`m4Kb0Zq7t1sVX9rL2pYwN6uHdA8c\nJfE3gQiT5oRsB0k=`)).toBe(REAL);
    expect(cleanToken(`  ${REAL}  `)).toBe(REAL);
  });

  it("does not eat a quote that is not a pair", () => {
    // Walker could generate a token some other way; only a matched pair is
    // safe to strip, because a lone quote might be part of the value.
    expect(cleanToken(`"abc`)).toBe('"abc');
  });
});

describe("checkToken", () => {
  it("accepts a real token and returns the cleaned value", () => {
    const result = checkToken(`CRM_API_TOKEN=${REAL}`);
    expect(result).toEqual({ ok: true, token: REAL });
  });

  it("refuses an empty box with something to do about it", () => {
    const result = checkToken("   ");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/paste the token/i);
  });

  it("names the .env.example placeholder instead of letting it 401", () => {
    // Every one of the eighteen ClearPath templates ships this literal string
    // in `.env.example`, so a client copying the wrong line pastes it.
    const result = checkToken("replace-with-a-long-random-string");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/example token/i);
    expect(result.ok === false && result.message).toMatch(/ClearPath/);
  });

  it("catches the placeholder even when it arrives as a whole env line", () => {
    const result = checkToken('CRM_API_TOKEN="a-long-random-string"');
    expect(result.ok).toBe(false);
  });
});
