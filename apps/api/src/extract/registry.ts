import { amazonAdapter } from "./amazon";
import { meeshoAdapter } from "./meesho";
import { myntraAdapter } from "./myntra";
import type { PlatformAdapter } from "./types";

/** Add a new platform by implementing PlatformAdapter and listing it here. */
export const adapters: PlatformAdapter[] = [amazonAdapter, myntraAdapter, meeshoAdapter];
export const adapterFor = (id: string): PlatformAdapter | undefined => adapters.find((a) => a.id === id);
