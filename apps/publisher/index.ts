import { randomUUID } from "node:crypto";
import { db } from "../../packages/db/index";
import { requireEnabled } from "../../packages/publishing/security";
import { claim } from "../../packages/publishing/queue";
import { runOperation } from "../../packages/publishing/runner";
requireEnabled();
await db.migrate();
const instance = randomUUID();
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
console.log(
  "[publisher] Started. Real browser operations only run for explicitly queued owner tasks.",
);
while (!stopped) {
  try {
    const job = await claim(instance);
    if (job) await runOperation(job, instance);
    else await new Promise((r) => setTimeout(r, 1500));
  } catch {
    console.error("[publisher] Task iteration failed; no automatic repost.");
    await new Promise((r) => setTimeout(r, 3000));
  }
}
await db.close();
