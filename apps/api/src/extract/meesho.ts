import { genericExtract } from "./generic";
import type { PlatformAdapter } from "./types";

export const meeshoAdapter: PlatformAdapter = {
  id: "meesho",
  hosts: ["meesho.com"],
  canonicalUrl: (u) => (/\/p\/[a-z0-9]+/i.test(u.pathname) ? `https://www.meesho.com${u.pathname}` : null),
  extract(html, finalUrl) {
    const f = genericExtract(html, finalUrl);
    const title = f.title?.replace(/\s*[|\-–]\s*(buy|online|meesho).*$/i, "").trim() || f.title;
    return { ...f, title };
  },
  isUnavailable: (html) => /out of stock|currently unavailable|no longer available/i.test(html) && !/"availability"\s*:\s*"[^"]*InStock/i.test(html),
};
