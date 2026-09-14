/**
 * 実GPU向け Spike Prewarm A/B プローブ。
 * 既定の Playwright swiftshader ではなく、起動中の Vite Studio（:5183）に対して実行する。
 *
 * 使い方:
 *   pnpm dev   # 別ターミナル
 *   pnpm exec tsx scripts/spike-prewarm-probe.ts
 *
 * Windows ホスト GPU を使う場合（WSL）:
 *   SPIKE_PROBE_CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
 *     pnpm exec tsx scripts/spike-prewarm-probe.ts
 */
import { chromium } from "@playwright/test";
import { access, mkdir, writeFile } from "node:fs/promises";
import { writeSpikePrewarmSummaryFromDisk } from "./spike-prewarm-summary";

const BASE = process.env.SPIKE_PROBE_BASE ?? "http://127.0.0.1:5183";

type SpikeDump = Record<string, unknown>;

async function resolveChromePath() {
  if (process.env.SPIKE_PROBE_CHROME) return process.env.SPIKE_PROBE_CHROME;
  const candidates = [
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

async function flyAndDump(
  page: import("@playwright/test").Page,
  label: string,
  query = "",
) {
  await page.goto(`${BASE}/${query}`);
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  const stats = page.getByLabel("Runtime Stats");
  await stats.waitFor({ state: "visible", timeout: 30000 });

  // 初スロットルを確実に取るため、短く待ってから W。
  await page.waitForTimeout(500);
  await page.keyboard.down("w");
  await page.waitForTimeout(900);
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowDown");
  // firstThrustFrame は永続化されるので長めに飛んでもよい。
  await page.waitForTimeout(8000);
  await page.keyboard.up("w");

  const hud = await stats.innerText();
  const position = JSON.parse(
    (await page
      .getByTestId("runtime-position")
      .getAttribute("data-position")) ?? "[0,0,0]",
  ) as number[];
  const dump = (await page.evaluate(() => {
    const fn = (
      window as unknown as {
        __exportSpikeDiagnostics?: () => SpikeDump;
      }
    ).__exportSpikeDiagnostics;
    if (!fn) throw new Error("__exportSpikeDiagnostics is missing");
    return fn();
  })) as SpikeDump;

  await mkdir("docs/evidence", { recursive: true });
  const path = `docs/evidence/spike-flight-${label}.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        label,
        query,
        savedAt: new Date().toISOString(),
        note: "spike-prewarm-probe: Vite :5183 thruster/prewarm A/B",
        hud,
        position,
        dump,
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${path}`);
  // 停止時の診断保存ダイアログを避けるため、ページを閉じるだけにする。
}

async function main() {
  const chromePath = await resolveChromePath();
  const browser = await chromium.launch({
    executablePath: chromePath,
    channel: chromePath ? undefined : "chromium",
    headless: true,
    args: [
      "--ignore-gpu-blocklist",
      "--enable-webgl",
      "--use-gl=angle",
      "--enable-features=Vulkan",
    ],
  });
  console.log(`browser: ${chromePath ?? "playwright-chromium"}`);
  try {
    for (const [label, query] of [
      ["prewarm-a", ""],
      ["prewarm-b", "?prewarmShaders=1"],
    ] as const) {
      const page = await browser.newPage();
      page.on("dialog", async (dialog) => {
        try {
          await dialog.accept();
        } catch {
          /* page may already be closing */
        }
      });
      try {
        await flyAndDump(page, label, query);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }
  const summary = await writeSpikePrewarmSummaryFromDisk();
  if (!summary.written) {
    console.error("summary missing:", summary.missing);
    process.exit(1);
  }
  console.log(JSON.stringify(summary.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
