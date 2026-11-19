import { describe, expect, it } from "vitest";
import { matchesKeyword, parseKeywords, renderTemplate, utf8Bytes, validateTemplate, DEFAULT_TEMPLATE } from "./automation";

describe("keyword matching", () => {
  it.each([
    ["LINK", "link", "word", true],
    ["link please 🙏", "link", "word", true],
    ["Can I get the link?", "link", "word", true],
    ["linked in bio", "link", "word", false],
    ["linked in bio", "link", "contains", true],
    ["  LINK!!! ", "link", "exact", true],
    ["link pls", "link", "exact", false],
    ["send link pls", "send link", "word", true],
    ["Ｌｉｎｋ", "link", "word", true],              // full-width letters (NFKC)
    ["li​nk", "link", "word", true],             // zero-width space removed
    ["लिंक भेजो", "लिंक", "word", true],             // Devanagari
    ["लिंकभेजो", "लिंक", "word", false],
    ["", "link", "contains", false],
    ["c++ guide", "c++", "word", true],               // regex characters are escaped
  ] as const)("%s ~ %s (%s) → %s", (comment, kw, mode, expected) => expect(matchesKeyword(comment, kw, mode)).toBe(expected));

  it("parses, normalises and de-duplicates keywords", () => {
    expect(parseKeywords("Link, LINK , shoes,,\nPrice")).toEqual(["link", "shoes", "price"]);
    expect(parseKeywords([" ", ",", "!!", "🔥", "link, price"])).toEqual(["🔥", "link", "price"]);
  });
});

describe("templates", () => {
  const v = { collectionUrl: "https://x.dev/c/winter?s=instagram", collectionName: "Winter Fits" };
  it("renders variables and tidies an empty username", () => {
    expect(renderTemplate("Hey [USERNAME]! [COLLECTION_NAME]: [COLLECTION_URL]", { ...v, username: "asha" })).toBe("Hey @asha! Winter Fits: https://x.dev/c/winter?s=instagram");
    expect(renderTemplate("Hey [USERNAME]! [COLLECTION_URL]", { ...v, username: null })).toBe("Hey! https://x.dev/c/winter?s=instagram");
  });
  it("validates: requires the URL, rejects unknown variables and over-long messages", () => {
    expect(validateTemplate(DEFAULT_TEMPLATE, v).ok).toBe(true);
    expect(validateTemplate("Here you go!", v).errors.join()).toMatch(/must include \[COLLECTION_URL\]/);
    expect(validateTemplate("[COLLECTION_URL] [PRICE]", v).errors.join()).toMatch(/Unknown variable \[PRICE\]/);
    expect(validateTemplate("", v).ok).toBe(false);
    const long = validateTemplate("[COLLECTION_URL] " + "é".repeat(500), v);
    expect(long.ok).toBe(false);
    expect(long.maxBytes).toBeGreaterThan(1000);
  });
  it("counts UTF-8 bytes, not characters", () => {
    expect(utf8Bytes("👇")).toBe(4);
    expect(utf8Bytes("é")).toBe(2);
  });
});
