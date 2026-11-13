import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, NEW_PASSWORD } from "./r3a-helpers";

// Starts from the saved demo session (signed in, onboarded), like every spec that is not about signing in.

test("change password: needs the current one, explains weak ones, signs the other devices out", async ({ page }) => {
  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "Ganti password" })).toBeVisible();

  const current = page.getByLabel("Password sekarang", { exact: true });
  const next = page.getByLabel("Password baru", { exact: true });
  const confirm = page.getByLabel("Ulangi password baru", { exact: true });
  const submit = page.getByRole("button", { name: "Ganti password" });

  await current.fill("salah-salah-1");
  await next.fill(NEW_PASSWORD);
  await confirm.fill(NEW_PASSWORD);
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: "Password lama belum benar." })).toBeVisible();

  await next.fill("pendek");
  await expect(page.getByText("Password minimal 10 karakter.")).toBeVisible();
  await expect(submit).toBeDisabled();

  await current.fill(DEMO_PASSWORD);
  await next.fill(NEW_PASSWORD);
  await confirm.fill(NEW_PASSWORD);
  await submit.click();
  await expect(page.getByRole("status").filter({ hasText: "Password diganti. Perangkat lain sudah keluar." })).toBeVisible();
  await expect(current).toHaveValue("");

  await page.goto("/settings/devices");
  await expect(page.getByText("Perangkat ini").first()).toBeVisible();
  await expect(page.getByText("Contoh: iPhone Safari")).toHaveCount(0);
});

test("the account page keeps the password fields private and labelled", async ({ page }) => {
  await page.goto("/settings/account");
  for (const label of ["Password sekarang", "Password baru", "Ulangi password baru"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("type", "password");
  }
  await expect(page.getByLabel("Password sekarang", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByLabel("Password baru", { exact: true })).toHaveAttribute("autocomplete", "new-password");
});
