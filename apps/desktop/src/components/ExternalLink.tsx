import type { AnchorHTMLAttributes } from "react";
import { openExternal } from "../lib/open";

/** Link that opens in the default browser. A plain target="_blank" does nothing in the native webview. */
export function ExternalLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} rel="noreferrer" {...rest} onClick={(e) => { e.preventDefault(); openExternal(href).catch(() => undefined); }}>
      {children}
    </a>
  );
}
