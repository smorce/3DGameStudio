import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
const checks = [
  ["typecheck", "typecheck"],
  ["lint", "lint"],
  ["format", "format:check"],
  ["unit", "test:unit"],
  ["integration", "test:integration"],
  ["test", "test"],
  ["build", "build"],
  ["e2e", "test:e2e"],
  ["smoke", "smoke"],
];
const results = [];
for (const [name, script] of checks) {
  const started = Date.now();
  let output = "";
  const child = spawn("pnpm", [script], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  const entry = {
    name,
    command: `pnpm ${script}`,
    status: code === 0 ? "PASS" : "FAIL",
    exitCode: code,
    durationMs: Date.now() - started,
  };
  results.push(entry);
  await writeFile(`docs/evidence/world-runtime-${name}.log`, output);
  await writeFile(
    "docs/evidence/world-runtime-quality-gates.json",
    JSON.stringify(
      { checkedAt: new Date().toISOString(), checks: results },
      null,
      2,
    ) + "\n",
  );
  console.log(`${name}: ${entry.status} (${entry.durationMs} ms)`);
  if (code !== 0) {
    console.log(output.slice(-6000));
    process.exitCode = 1;
    break;
  }
}
