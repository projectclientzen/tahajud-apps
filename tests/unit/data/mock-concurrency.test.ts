import { describe, expect, it } from "vitest";
import { createMockDataLayer } from "@/data/mock";
import type { MockState, StateStorage } from "@/data/mock/state";
import { createMockAuth } from "@/data/mock";
import { memoryAuthStorage } from "@/data/mock/auth";
import { memoryStorage } from "@/data/mock/storage";
import { wib } from "../domain/helpers";

/** Storage whose reads and writes take a few macrotasks, like IndexedDB on a busy machine. */
function slowStorage(inner: StateStorage, delays: { load?: number; save?: number } = {}): StateStorage {
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  return {
    async load() {
      await wait(delays.load ?? 5);
      return inner.load();
    },
    async save(s: MockState) {
      const copy = structuredClone(s);
      await wait(delays.save ?? 5);
      return inner.save(copy);
    },
    clear: () => inner.clear(),
  };
}

const clock = { now: () => wib("2026-11-12 08:00") };

/** A returning user: state already in storage, a new page opens a fresh engine on it. */
async function seeded(): Promise<StateStorage> {
  const backing = memoryStorage();
  const first = createMockDataLayer({ userId: "u1", scenario: "five_nights_completed", storage: backing, clock });
  await first.profile.getProfile();
  return backing;
}

describe("mock data layer: several reads and writes in flight before the first load finishes", () => {
  it("keeps a write that starts while another call is still loading the state", async () => {
    const backing = await seeded();
    const layer = createMockDataLayer({
      userId: "u1",
      scenario: "five_nights_completed",
      storage: slowStorage(backing),
      clock,
    });
    // The settings screen fires five reads at once, and a write can land in the same tick.
    const [, prefs] = await Promise.all([layer.quran.getProgress(), layer.notifications.getPreferences()]);
    const next = { ...prefs, bedtime: { ...prefs.bedtime, target_sleep_time: "23:05" } };
    const reads = Promise.all([layer.profile.getProfile(), layer.prayer.getNextFajr()]);
    await layer.notifications.putPreferences(next);
    await reads;
    expect((await layer.notifications.getPreferences()).bedtime.target_sleep_time).toBe("23:05");
    expect((await backing.load())!.notificationPrefs.bedtime.target_sleep_time).toBe("23:05");
  });

  it("a write issued before the first load completes survives and is persisted", async () => {
    const backing = await seeded();
    const layer = createMockDataLayer({
      userId: "u1",
      scenario: "five_nights_completed",
      storage: slowStorage(backing),
      clock,
    });
    // Nothing has loaded yet: all of these race on the first storage read.
    const results = await Promise.all([
      layer.quran.getProgress(),
      layer.dev.setNow("2026-11-12T12:00:00.000Z"),
      layer.quran.putProgress(36, { ayah: 12 }),
      layer.profile.getProfile(),
    ]);
    expect(results[0]).toBeDefined();
    expect(layer.dev.now().toISOString()).toBe("2026-11-12T12:00:00.000Z");
    const stored = (await backing.load())!;
    expect(stored.clockOverride).toBe("2026-11-12T12:00:00.000Z");
    expect(stored.quranProgress["36"]?.ayah).toBe(12);
    expect((await layer.quran.getProgress()).find((p) => p.surah === 36)?.ayah).toBe(12);
  });

  it("saves reach storage in the order they were issued", async () => {
    const backing = memoryStorage();
    let n = 0;
    const storage: StateStorage = {
      load: () => backing.load(),
      clear: () => backing.clear(),
      async save(s) {
        // The first write is slower than the second. Unordered writes would let the old snapshot win.
        const copy = structuredClone(s);
        await new Promise((r) => setTimeout(r, n++ === 0 ? 30 : 1));
        await backing.save(copy);
      },
    };
    const layer = createMockDataLayer({ userId: "u1", scenario: "five_nights_completed", storage, clock });
    await layer.profile.getProfile();
    n = 0;
    await Promise.all([layer.quran.putProgress(36, { ayah: 5 }), layer.quran.putProgress(36, { ayah: 9 })]);
    expect((await backing.load())!.quranProgress["36"]?.ayah).toBe(9);
  });
});

describe("mock auth: concurrent first calls share one state", () => {
  it("does not replace the in-memory state while a second call is loading it", async () => {
    const inner = memoryAuthStorage();
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const storage = {
      load: async () => {
        await wait(5);
        return inner.load();
      },
      save: async (s: Parameters<typeof inner.save>[0]) => {
        const copy = structuredClone(s);
        await wait(5);
        return inner.save(copy);
      },
      clear: () => inner.clear(),
    };
    const auth = createMockAuth({ scenario: "logged_in", clock: { now: () => wib("2026-11-12 08:00") }, storage });
    const [a, b] = await Promise.all([auth.getSession(), auth.dev.issueResetToken("demo@ngajigaes.test")]);
    await auth.dev.setNow("2026-11-12T12:00:00.000Z");
    await auth.dev.setEntitlement("demo@ngajigaes.test", "suspended");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect((await inner.load())!.clockOverride).toBe("2026-11-12T12:00:00.000Z");
  });
});
