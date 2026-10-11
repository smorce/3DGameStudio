import { test as base, expect } from "@playwright/test";
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [],
        consoleLog: string[] = [];
      page.on("pageerror", (error) =>
        errors.push(error.stack ?? error.message),
      );
      page.on("console", (message) => {
        consoleLog.push(`${message.type()}: ${message.text()}`);
        if (message.type() === "error") errors.push(message.text());
      });
      await use();
      await testInfo.attach("browser-console", {
        body: consoleLog.join("\n"),
        contentType: "text/plain",
      });
      expect(
        errors,
        "Browser must not report unhandled exceptions or console errors",
      ).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
export type { Page } from "@playwright/test";

/** 正式証跡は明示指定した実行だけで更新する。 */
export function evidencePath(file: string) {
  return process.env.UPDATE_E2E_EVIDENCE === "1"
    ? file
    : file.replace(/^docs\//, "test-results/generated-evidence/");
}
