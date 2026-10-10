import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/admin/reset", { headers: { "x-actor": "e2e" } });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("mw.reviewer", "E2E Reviewer"));
});

test("plan → approve → crash → retry → reconcile → rollback", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/plan");
  await page.getByRole("button", { name: /Generate plan with agent/ }).click();
  await expect(page.getByText("Field mappings")).toBeVisible();
  await expect(page.getByText("1 error block approval")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve…" })).toBeDisabled();

  // Answer the blocking consent question → new version.
  await page.getByPlaceholder("Required before approval").fill("Confirmed with legal: default to false.");
  await page.getByRole("button", { name: "Save as v2" }).click();
  await expect(page.getByText("Reviewer edit")).toBeVisible();

  // Dry run, then approve with explicit high-risk acknowledgement.
  await page.getByRole("button", { name: "Run dry run" }).click();
  await expect(page.getByText("137 accepted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve…" }).click();
  const approve = page.getByRole("button", { name: "Approve plan" });
  await expect(approve).toBeDisabled();
  for (const cb of await page.locator("dialog input[type=checkbox]").all()) await cb.check();
  await approve.click();
  await expect(page.getByText("Approved by E2E Reviewer")).toBeVisible();

  // Quarantine evidence.
  await page.getByRole("link", { name: /Dry run/ }).first().click();
  await expect(page.getByText("INVALID_DATE").first()).toBeVisible();
  await expect(page.getByText("DUPLICATE_KEY").first()).toBeVisible();

  // Crash part-way, then retry: no duplicates, reconciliation matches.
  await page.getByRole("link", { name: /Execute/ }).first().click();
  await page.getByText("Simulate a crash").click();
  await page.getByRole("button", { name: "Execute migration" }).click();
  await expect(page.getByRole("button", { name: "Retry execution" })).toBeVisible();
  await expect(page.getByText("incomplete", { exact: true }).first()).toBeVisible();
  await page.getByText("Simulate a crash").click();
  await page.getByRole("button", { name: "Retry execution" }).click();
  await expect(page.getByText("matched", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("137 rows", { exact: true })).toBeVisible();

  // Roll back.
  await page.getByRole("button", { name: "Roll back v2" }).click();
  await page.getByPlaceholder(/Tier mapping/).fill("E2E rollback");
  await page.getByRole("dialog").getByRole("button", { name: "Roll back" }).click();
  await expect(page.getByText("The target is empty.")).toBeVisible();

  // History shows the whole story.
  await page.getByRole("link", { name: /History/ }).click();
  for (const text of [/v2 approved/, /Attempt 1 failed after 50 rows/, /Retry of v2 started/, /v2 rolled back: 137 row/]) {
    await expect(page.getByText(text).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});
