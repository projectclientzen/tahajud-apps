import { describe, expect, it } from "vitest";
import { ApiError, profileSchema } from "@/data/contracts";
import { createMockDataLayer, type MockDataLayer, type ScenarioName } from "@/data";
import { memoryStorage } from "@/data/mock/storage";
import { wib } from "../domain/helpers";

const make = (scenario: ScenarioName, at = "2026-11-12 14:00"): MockDataLayer =>
  createMockDataLayer({ userId: "profile-user", scenario, storage: memoryStorage(), clock: { now: () => wib(at) } });

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "no-error";
  } catch (e) {
    return e instanceof ApiError ? e.code : String(e);
  }
}

describe("profile repository", () => {
  it("returns a profile that matches the contract", async () => {
    const p = profileSchema.parse(await make("five_nights_completed").profile.getProfile());
    expect(p).toMatchObject({
      display_name: "Pengguna Demo",
      schedule_mode: "region",
      onboarding_completed: true,
      theme_pref: "system",
      quran_font_size: 30,
      dhikr_font_size: 28,
    });
  });

  it("S2-3: onboarding sets program_start_date to the first session still open, not the calendar date", async () => {
    const l = make("onboarding_pending", "2026-11-12 14:00"); // after the 12.00 cutoff
    const before = await l.profile.getProfile();
    expect(before).toMatchObject({ onboarding_completed: false, program_start_date: null, region_id: null });
    await l.profile.setLocation({ mode: "region", region_id: "demo-jakarta" });
    const done = await l.profile.completeOnboarding();
    expect(done).toMatchObject({ onboarding_completed: true, program_start_date: "2026-11-13" });
    // nothing is "Terlewat" on day one
    const d = await l.report.getDashboard();
    expect(d.status_counts).toMatchObject({ missed: 0, upcoming: 1 });
    expect(d.completion_rate).toBeNull();
    expect((await l.access.getAccess()).onboarding_completed).toBe(true);
  });

  it("onboarding before noon starts the same day", async () => {
    const l = make("onboarding_pending", "2026-11-12 09:00");
    await l.profile.setLocation({ mode: "region", region_id: "demo-jakarta" });
    expect((await l.profile.completeOnboarding()).program_start_date).toBe("2026-11-12");
  });

  it("completing twice does not move the start date", async () => {
    const l = make("onboarding_pending", "2026-11-12 09:00");
    await l.profile.setLocation({ mode: "region", region_id: "demo-jakarta" });
    await l.profile.completeOnboarding();
    await l.dev.setNow(wib("2026-11-20 09:00").toISOString());
    expect((await l.profile.completeOnboarding()).program_start_date).toBe("2026-11-12");
  });

  it("needs a region or a manual schedule before onboarding can finish", async () => {
    const l = make("onboarding_pending");
    expect(await code(l.profile.completeOnboarding())).toBe("VALIDATION_ERROR");
    expect((await l.prayer.getNextFajr()).available).toBe(false); // no region, no schedule shown
    const m = await l.profile.setLocation({ mode: "manual", timezone: "Asia/Riyadh", fajr_time: "04:50" });
    expect(m).toMatchObject({ label: "Diatur manual", timezone: "Asia/Riyadh", demo_note: null });
    expect((await l.profile.completeOnboarding()).schedule_mode).toBe("manual");
  });

  it("setLocation through the profile and prayer repositories behaves the same", async () => {
    const l = make("new_account");
    const a = await l.profile.setLocation({ mode: "region", region_id: "demo-makassar" });
    expect(a).toMatchObject({ timezone: "Asia/Makassar", region_id: "demo-makassar" });
    expect((await l.profile.getProfile()).timezone).toBe("Asia/Makassar");
    expect(await code(l.profile.setLocation({ mode: "region", region_id: "x" }))).toBe("NOT_FOUND");
  });

  it("updates the display name and display preferences, rejects out-of-range sizes", async () => {
    const l = make("new_account");
    expect((await l.profile.updateProfile({ display_name: "Zen" })).display_name).toBe("Zen");
    expect((await l.profile.updateProfile({ display_name: "" })).display_name).toBeNull();
    const p = await l.profile.updatePreferences({ theme_pref: "auto-night", quran_font_size: 36 });
    expect(p).toMatchObject({ theme_pref: "auto-night", quran_font_size: 36, dhikr_font_size: 28 });
    await expect(l.profile.updatePreferences({ dhikr_font_size: 50 })).rejects.toThrow();
    await expect(l.profile.updatePreferences({ theme_pref: "neon" as never })).rejects.toThrow();
    expect((await l.profile.getProfile()).theme_pref).toBe("auto-night");
  });

  it("blocks profile calls without an active entitlement", async () => {
    for (const s of ["purchase_pending", "no_active_access"] as const) {
      expect(await code(make(s).profile.getProfile())).toBe("ENTITLEMENT_INACTIVE");
    }
  });

  it("fills profile defaults for state saved before S4a", async () => {
    const storage = memoryStorage();
    const first = createMockDataLayer({
      userId: "old",
      scenario: "new_account",
      storage,
      clock: { now: () => wib("2026-11-12 09:00") },
    });
    const st = await first.dev.snapshot();
    delete (st as { profile?: unknown }).profile;
    await storage.save(st);
    const again = createMockDataLayer({ userId: "old", storage, clock: { now: () => wib("2026-11-12 09:00") } });
    expect(await again.profile.getProfile()).toMatchObject({ theme_pref: "system", display_name: null });
  });
});
