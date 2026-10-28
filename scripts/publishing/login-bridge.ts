import { createInterface } from "node:readline";
import { runLoginBrowser, type LoginControl } from "../../packages/publishing/login-browser";
import { loginFailure } from "../../packages/publishing/login-errors";

// Dedicated process. No repository env loader, DB, logging of request bodies, or credential files.
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let started = false;
const controls: LoginControl[] = [];
const emit = (value: unknown) => { process.stdout.write(JSON.stringify(value) + "\n"); };
lines.on("line", line => {
  if (line.length > 2 * 1024 * 1024) { process.exitCode = 1; lines.close(); return; }
  try {
    const value = JSON.parse(line);
    if (!started) {
      started = true;
      if (!["login", "check"].includes(value.kind)) throw new Error("Invalid operation");
      void runLoginBrowser(value, async () => controls.shift(), emit)
        .then( result => emit({ type: "result", ...result }))
        .catch(error => emit({ type: "result", ...loginFailure(error) }))
        .finally(() => { lines.close(); process.stdin.destroy(); });
    } else if (controls.length < 8) controls.push(value);
  } catch { emit({ type: "result", state: "failed", detail: "登录控制格式无效" }); lines.close(); }
});
lines.on("close", () => { controls.length = 0; controls.push({ action: "cancel" }); });
