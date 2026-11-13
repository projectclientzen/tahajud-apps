import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above the imports, so the spy it uses must be hoisted too.
const web = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("web-push", () => ({
  sendNotification: web.sendNotification,
  setVapidDetails: web.setVapidDetails,
  WebPushError: class WebPushError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
    }
  },
}));

import { WebPushSender } from "@/server/push";

const vapid = { subject: "mailto:dev@example.test", publicKey: "pub", privateKey: "priv" };
const sub = { id: "s1", endpoint: "https://push.example.test/s1", p256dh: "p", auth: "a" };
const payload = {
  type: "tahajud" as const,
  title: "Waktunya tahajud",
  body: "Yuk bangun pelan-pelan.",
  url: "/dashboard",
};

const ttlOfLastCall = () => (web.sendNotification.mock.calls.at(-1)![2] as { TTL: number }).TTL;

beforeEach(() => {
  web.sendNotification.mockReset();
  web.sendNotification.mockResolvedValue({ statusCode: 201 });
});

describe("push TTL per message", () => {
  it("uses the sender default (15 minutes) when the caller gives none", async () => {
    await new WebPushSender({ vapid }).send(sub, payload);
    expect(ttlOfLastCall()).toBe(900);
  });

  it("uses the per-message TTL: the notification type's expiry decides how long the push service may keep it", async () => {
    const s = new WebPushSender({ vapid });
    await s.send(sub, payload, { ttlSeconds: 360 * 60 }); // al-kahfi: 6 hours
    expect(ttlOfLastCall()).toBe(21_600);
    await s.send(sub, payload, { ttlSeconds: 30 * 60 }); // bedtime: 30 minutes
    expect(ttlOfLastCall()).toBe(1800);
  });

  it("rounds a fractional TTL down and never goes below one second", async () => {
    const s = new WebPushSender({ vapid });
    await s.send(sub, payload, { ttlSeconds: 599.9 });
    expect(ttlOfLastCall()).toBe(599);
    await s.send(sub, payload, { ttlSeconds: 0 });
    expect(ttlOfLastCall()).toBe(1);
    await s.send(sub, payload, { ttlSeconds: -50 });
    expect(ttlOfLastCall()).toBe(1);
  });

  it("keeps the same TTL on every retry of one message", async () => {
    web.sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 503 }))
      .mockResolvedValueOnce({ statusCode: 201 });
    const s = new WebPushSender({ vapid, sleep: async () => {} });
    const out = await s.send(sub, payload, { ttlSeconds: 1200 });
    expect(out).toMatchObject({ status: "sent", attempts: 2 });
    expect(web.sendNotification.mock.calls.map((c) => (c[2] as { TTL: number }).TTL)).toEqual([1200, 1200]);
  });
});
