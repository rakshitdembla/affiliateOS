import { app } from "./app";
import type { Env } from "./env";
import { runScheduled } from "./scheduled";

export default {
  fetch: app.fetch,
  /** Daily cron (see wrangler.jsonc): refresh Instagram tokens before they expire, purge stale OAuth states. */
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
