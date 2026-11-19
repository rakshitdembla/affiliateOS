import { genericExtract } from "./generic";
import type { PlatformAdapter } from "./types";

export const myntraAdapter: PlatformAdapter = {
  id: "myntra",
  hosts: ["myntra.com", "myntr.it"],
  canonicalUrl: (u) => (/\/\d+\/buy\/?$/.test(u.pathname) ? `https://www.myntra.com${u.pathname}` : null),
  extract(html, finalUrl) {
    const f = genericExtract(html, finalUrl);
    // Myntra titles often read "Brand Product | Buy ... Myntra" — keep the product part only.
    const title = f.title?.replace(/\s*[|\-–]\s*(buy|shop).*$/i, "").replace(/\s*[|\-–]\s*myntra\s*$/i, "").trim() || f.title;
    return { ...f, title };
  },
  isUnavailable: (html) => /out of stock|product (is )?no longer available|sold out/i.test(html) && !/"availability"\s*:\s*"[^"]*InStock/i.test(html),
};
