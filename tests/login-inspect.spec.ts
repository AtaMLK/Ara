import { test } from "@playwright/test";

test("Inspect ARAT login UI", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("pageerror", e => consoleErrors.push(e.message));
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("requestfailed", req => {
    failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });

  await page.goto("http://192.168.1.32:3000/login");
  await page.waitForLoadState("networkidle").catch(() => {});

  console.log("TITLE:", JSON.stringify(await page.title()));
  console.log("URL:", page.url());
  console.log("BODY TEXT:", (await page.locator("body").innerText()).slice(0, 6000));
  console.log("INPUTS:", JSON.stringify(await page.locator("input").evaluateAll(els =>
    els.map((e: HTMLInputElement) => ({
      type: e.type,
      name: e.name,
      placeholder: e.placeholder,
      autocomplete: e.autocomplete,
      ariaLabel: e.getAttribute("aria-label")
    }))
  ), null, 2));
  console.log("BUTTONS:", JSON.stringify(await page.getByRole("button").allTextContents(), null, 2));
  console.log("LINKS:", JSON.stringify(await page.locator("a").evaluateAll(els =>
    els.map((e: HTMLAnchorElement) => ({ text: e.innerText, href: e.getAttribute("href") }))
  ), null, 2));
  console.log("CONSOLE ERRORS:", JSON.stringify(consoleErrors, null, 2));
  console.log("FAILED REQUESTS:", JSON.stringify(failedRequests, null, 2));

  await page.screenshot({ path: "artifacts/arat-login.png", fullPage: true }).catch(async () => {
    await page.screenshot({ path: "arat-login.png", fullPage: true });
  });
});
