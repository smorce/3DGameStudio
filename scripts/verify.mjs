import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const steps = [
  ["install", ["install", "--frozen-lockfile"]],
  ["typecheck", ["typecheck"]],
  ["lint", ["lint"]],
  ["format", ["format:check"]],
  ["unit", ["test:unit"]],
  ["integration", ["test:integration"]],
  ["test", ["test"]],
  ["build", ["build"]],
  ["e2e", ["test:e2e"]],
  ["smoke", ["smoke"]],
];
mkdirSync("docs/evidence", { recursive: true });
const results = [];
for (const [name, args] of steps) {
  const started = Date.now();
  const result = spawnSync("pnpm", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(`docs/evidence/${name}.log`, log);
  const status = result.status === 0 ? "PASS" : "FAIL";
  results.push({
    name,
    command: `pnpm ${args.join(" ")}`,
    status,
    exitCode: result.status,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  });
  console.log(`${name}: ${status} (${results.at(-1).seconds}s)`);
  if (status === "FAIL") console.log(log.slice(-5000));
}
writeFileSync(
  "docs/evidence/quality-gates.json",
  JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) +
    "\n",
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
