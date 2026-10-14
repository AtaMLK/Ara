import { test, expect } from "@playwright/test";

test("ARAT login page loads", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", error => consoleErrors.push(error.message));

  const response = await page.goto("http://192.168.1.32:3000/login");

  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("body")).not.toBeEmpty();

  console.log("PAGE TITLE:", await page.title());
  console.log("CURRENT URL:", page.url());
  console.log("PAGE ERRORS:", JSON.stringify(consoleErrors, null, 2));
});
