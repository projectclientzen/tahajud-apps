import { chromium, type FullConfig } from "@playwright/test";
import { AUTH_FILE, finishOnboarding, signIn } from "./r3a-helpers";

/**
 * Signs in once through the real screens and saves the browser state (including IndexedDB).
 * Every other spec starts from it, so they open straight on the dashboard like a returning user.
 * The login specs opt out with an empty storage state.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    baseURL,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  await signIn(page);
  await finishOnboarding(page);
  await ctx.storageState({ path: AUTH_FILE, indexedDB: true });
  await browser.close();
}
