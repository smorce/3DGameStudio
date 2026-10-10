# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: alpine-village.spec.ts >> Alpine Village: 景観・再読込・車の移動と同条件の描画性能
- Location: tests/e2e/alpine-village.spec.ts:18:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0

Call Log:
- Timeout 90000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- main [ref=f2e3]:
  - generic [ref=f2e4]:
    - link "Machine Studio" [ref=f2e5] [cursor=pointer]:
      - /url: "#"
      - generic [ref=f2e6]:
        - text: m
        - generic [ref=f2e7]: ▰
      - generic [ref=f2e8]:
        - text: MACHINE
        - generic [ref=f2e9]: STUDIO
    - generic [ref=f2e10]:
      - button "つくる" [disabled] [ref=f2e11]
      - button "くわしくつくる" [disabled] [ref=f2e12]
      - button "Studio" [disabled] [ref=f2e13]
    - button "保存" [disabled] [ref=f2e14]
    - button "■ やめる" [ref=f2e15] [cursor=pointer]
  - generic [ref=f2e16]:
    - generic "3Dビューポート" [ref=f2e17]
    - generic:
      - text: YOUR NEXT GREAT IDEA
      - heading "走ってみよう。" [level=1]
      - paragraph: W / ↑ 進む · A D 曲がる · Space ブレーキ · R もどる
    - status "Runtime Stats":
      - generic: Rebase 1 · Origin 0, 192 · Hinge 0.000m · SyncGen 13 · Gen 14.1ms
      - generic: RAF 466.6ms · max 983.3 · p95 516.7 · p99 650.0 · CPU 14.4 · UI 0.2 · Commit 0.0ms · Queue 0 · W 0/4
      - generic: Spike >20/>33/>50 298/295/294 · early 289/286/285 · SyncFb 0 · fastStats
      - generic: CamFollow INSTANT · α 1.00
      - generic: RebaseMs 4.70 (P 3.80 / R 0.80 / C 0.00 / T 0.10) · RB 1 · SC 2379 · Ch 173 · LOD 570
      - generic: Shadow→ 0.0, -212.0
      - generic: 位置 6.00, 200.87 · 高さ 11.95
    - status "Speed":
      - generic: SPEED
      - strong:
        - text: "31"
        - generic: km/h
    - generic [ref=f2e18]:
      - button "↶ 元に戻す" [disabled] [ref=f2e19]
      - button "↷ やり直す" [disabled] [ref=f2e20]
      - button "新しくつくる" [disabled] [ref=f2e21]
    - generic [ref=f2e22]:
      - button "← 左" [ref=f2e23] [cursor=pointer]
      - button "↑ すすむ" [ref=f2e24] [cursor=pointer]
      - button "右 →" [ref=f2e25] [cursor=pointer]
  - generic [ref=f2e26]:
    - generic [ref=f2e27]:
      - text: テスト走行中
      - generic [ref=f2e29]: 15 パーツ
    - navigation "パーツをえらぶ" [ref=f2e30]:
      - button "▱ 板" [disabled] [ref=f2e31]:
        - generic [ref=f2e32]: ▱
        - text: 板
      - button "◉ タイヤ" [disabled] [ref=f2e33]:
        - generic [ref=f2e34]: ◉
        - text: タイヤ
      - button "⌁ サスペンション" [disabled] [ref=f2e35]:
        - generic [ref=f2e36]: ⌁
        - text: サスペンション
      - button "⚙ モーター" [disabled] [ref=f2e37]:
        - generic [ref=f2e38]: ⚙
        - text: モーター
      - button "➤ ジェット" [disabled] [ref=f2e39]:
        - generic [ref=f2e40]: ➤
        - text: ジェット
      - button "━ 関節" [disabled] [ref=f2e41]:
        - generic [ref=f2e42]: ━
        - text: 関節
      - button "▣ ブロック" [disabled] [ref=f2e43]:
        - generic [ref=f2e44]: ▣
        - text: ブロック
    - generic [ref=f2e45]:
      - text: くるっと見回す：ドラッグ ／ 近づく：スクロール
      - generic [ref=f2e46]: ひらめきに、限界はない。
```

# Test source

```ts
  215 |   const environment = await page.evaluate(() => {
  216 |     const gl = document.querySelector("canvas")?.getContext("webgl2");
  217 |     const debug = gl?.getExtension("WEBGL_debug_renderer_info");
  218 |     return {
  219 |       userAgent: navigator.userAgent,
  220 |       viewport: [innerWidth, innerHeight],
  221 |       pixelRatio: devicePixelRatio,
  222 |       renderer: debug
  223 |         ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)
  224 |         : "unavailable",
  225 |       vendor: debug
  226 |         ? gl?.getParameter(debug.UNMASKED_VENDOR_WEBGL)
  227 |         : "unavailable",
  228 |       memory: (
  229 |         performance as Performance & {
  230 |           memory?: {
  231 |             usedJSHeapSize: number;
  232 |             totalJSHeapSize: number;
  233 |             jsHeapSizeLimit: number;
  234 |           };
  235 |         }
  236 |       ).memory
  237 |         ? {
  238 |             usedJSHeapSize: (
  239 |               performance as Performance & {
  240 |                 memory: { usedJSHeapSize: number };
  241 |               }
  242 |             ).memory.usedJSHeapSize,
  243 |           }
  244 |         : null,
  245 |     };
  246 |   });
  247 |   await writeFile(
  248 |     testInfo.outputPath("performance.json"),
  249 |     JSON.stringify(
  250 |       {
  251 |         environment,
  252 |         backend: "Chromium ANGLE SwiftShader (software)",
  253 |         sampleWindowMs: 2000,
  254 |         runs,
  255 |       },
  256 |       null,
  257 |       2,
  258 |     ),
  259 |   );
  260 |   // 性能の採取後、同じAlpineの車を道路上で走らせて実際のRebaseを検証する。
  261 |   await page.evaluate(
  262 |     (view) =>
  263 |       (
  264 |         window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
  265 |       ).__MACHINE_STUDIO_AGENT__.setInspectionView(view.position, view.target),
  266 |     views.find((view) => view.name === "reference")!,
  267 |   );
  268 |   await expect
  269 |     .poll(
  270 |       () =>
  271 |         page.evaluate(() =>
  272 |           (
  273 |             window as unknown as {
  274 |               __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
  275 |             }
  276 |           ).__MACHINE_STUDIO_AGENT__.getRenderedEntityPosition(
  277 |             "gen:2:42:landmark:alpine-windmill",
  278 |           ),
  279 |         ),
  280 |       { timeout: 30000 },
  281 |     )
  282 |     .toBeDefined();
  283 |   const beforeRebase = await page.evaluate(() => {
  284 |     const api = (
  285 |       window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
  286 |     ).__MACHINE_STUDIO_AGENT__;
  287 |     return {
  288 |       state: api.getState(),
  289 |       mill: api.getRenderedEntityPosition("gen:2:42:landmark:alpine-windmill")!,
  290 |     };
  291 |   });
  292 |   await page
  293 |     .locator("canvas")
  294 |     .first()
  295 |     .screenshot({
  296 |       path: testInfo.outputPath("before-rebase.png"),
  297 |       style:
  298 |         "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
  299 |     });
  300 |   await page.keyboard.down("w");
  301 |   try {
  302 |     await expect
  303 |       .poll(
  304 |         () =>
  305 |           page.evaluate(
  306 |             () =>
  307 |               (
  308 |                 window as unknown as {
  309 |                   __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
  310 |                 }
  311 |               ).__MACHINE_STUDIO_AGENT__.getState().world.rebaseCount ?? 0,
  312 |           ),
  313 |         { timeout: 90000 },
  314 |       )
> 315 |       .toBeGreaterThan(beforeRebase.state.world.rebaseCount ?? 0);
      |        ^ Error: expect(received).toBeGreaterThan(expected)
  316 |   } finally {
  317 |     await page.keyboard.up("w");
  318 |   }
  319 |   await page.waitForTimeout(1500);
  320 |   const afterRebase = await page.evaluate(() => {
  321 |     const api = (
  322 |       window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
  323 |     ).__MACHINE_STUDIO_AGENT__;
  324 |     return {
  325 |       state: api.getState(),
  326 |       mill: api.getRenderedEntityPosition("gen:2:42:landmark:alpine-windmill"),
  327 |       events: api
  328 |         .getEvents()
  329 |         .filter(
  330 |           (event) =>
  331 |             event.name.includes("rebase") || event.name === "world.chunk.ready",
  332 |         ),
  333 |     };
  334 |   });
  335 |   expect(afterRebase.mill).toBeDefined();
  336 |   beforeRebase.mill.forEach((value, axis) =>
  337 |     expect(afterRebase.mill![axis]).toBeCloseTo(value, 3),
  338 |   );
  339 |   expect(afterRebase.state.machine.position!.every(Number.isFinite)).toBe(true);
  340 |   await page
  341 |     .locator("canvas")
  342 |     .first()
  343 |     .screenshot({
  344 |       path: testInfo.outputPath("after-rebase.png"),
  345 |       style:
  346 |         "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
  347 |     });
  348 |   await writeFile(
  349 |     testInfo.outputPath("rebase.json"),
  350 |     JSON.stringify({ beforeRebase, afterRebase }, null, 2),
  351 |   );
  352 | });
  353 | 
```