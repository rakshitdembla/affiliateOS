import { describe, expect, it } from "vitest";
import { sanitize } from "../src/logger";

describe("log sanitizer", () => {
  it.each([
    ["access_token=IGAAabc123&x=1", "access_token=[REDACTED]&x=1"],
    ['{"access_token":"EAAB123"}', '{"access_token":"[REDACTED]"}'],
    ["Authorization: Bearer abc.def", "Authorization: [REDACTED] [REDACTED]"],
    ["client_secret=s3cr3t", "client_secret=[REDACTED]"],
    ["token: xyz", "token: [REDACTED]"],
  ])("redacts %s", (input, expected) => expect(sanitize(input)).toBe(expected));

  it("leaves ordinary sentences that mention these words intact", () => {
    for (const msg of ["Webhook delivery received but no app secret is configured", "The token expired before it could be refreshed", "Password reset is not supported"]) {
      expect(sanitize(msg)).toBe(msg);
    }
  });

  it("redacts bare Meta/Instagram tokens anywhere", () => {
    expect(sanitize("got IGAAabcdefghijklmnopqrstuvwxyz0123456789 back")).toBe("got [REDACTED] back");
    expect(sanitize("got EAABabcdefghijklmnopqrstuvwxyz back")).toBe("got [REDACTED] back");
  });
});
