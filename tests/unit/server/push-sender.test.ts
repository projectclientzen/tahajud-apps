import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "node:https";
import type { AddressInfo } from "node:net";
import { generateVAPIDKeys } from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PushConfigError,
  WebPushSender,
  buildPayload,
  vapidFromEnv,
  type NotificationPayload,
  type PushSubscriptionRecord,
} from "@/server/push";

let dir: string;
let server: Server;
let port: number;
let agent: Agent;
let responses: number[] = [];
let hits: { path: string; headers: Record<string, string | string[] | undefined> }[] = [];

const vapid = { ...generateVAPIDKeys(), subject: "mailto:dev@example.test" };
const toVapid = () => ({ subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey });

function makeSub(path: string): PushSubscriptionRecord {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    id: "sub-1",
    endpoint: `https://127.0.0.1:${port}${path}`,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

const payload: NotificationPayload = { type: "tahajud", title: "Waktunya tahajud", body: "Yuk bangun pelan-pelan.", url: "/dashboard" };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "push-test-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
  ], { stdio: "ignore" });
  const cert = readFileSync(join(dir, "cert.pem"));
  server = createServer({ key: readFileSync(join(dir, "key.pem")), cert }, (req, res) => {
    req.resume();
    req.on("end", () => {
      hits.push({ path: req.url ?? "", headers: req.headers });
      res.statusCode = responses.shift() ?? 201;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  agent = new Agent({ ca: cert });
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const sender = (extra = {}) =>
  new WebPushSender({ vapid: toVapid(), agent, sleep: async () => {}, ...extra });

describe("WebPushSender", () => {
  it("sends with VAPID auth and a TTL", async () => {
    responses = [201];
    hits = [];
    const out = await sender().send(makeSub("/ok"), payload);
    expect(out).toEqual({ status: "sent", statusCode: 201, attempts: 1 });
    expect(hits[0]?.path).toBe("/ok");
    expect(String(hits[0]?.headers.authorization)).toMatch(/^vapid t=.+, k=.+/);
    expect(hits[0]?.headers.ttl).toBe("900");
  });

  it.each([404, 410])("marks the subscription for deactivation on %i without retry", async (code) => {
    responses = [code];
    hits = [];
    const out = await sender().send(makeSub("/gone"), payload);
    expect(out).toEqual({ status: "deactivate", statusCode: code, attempts: 1 });
    expect(hits).toHaveLength(1);
  });

  it("retries 429 then succeeds", async () => {
    responses = [429, 201];
    hits = [];
    const out = await sender().send(makeSub("/slow"), payload);
    expect(out).toEqual({ status: "sent", statusCode: 201, attempts: 2 });
    expect(hits).toHaveLength(2);
  });

  it("retries 5xx and gives up after maxAttempts", async () => {
    responses = [503, 500, 502];
    hits = [];
    const out = await sender({ maxAttempts: 3 }).send(makeSub("/down"), payload);
    expect(out).toMatchObject({ status: "failed", statusCode: 502, attempts: 3 });
    expect(hits).toHaveLength(3);
  });

  it("does not retry other 4xx", async () => {
    responses = [400];
    hits = [];
    const out = await sender().send(makeSub("/bad"), payload);
    expect(out).toMatchObject({ status: "failed", statusCode: 400, attempts: 1 });
    expect(hits).toHaveLength(1);
  });

  it("backs off exponentially", async () => {
    responses = [500, 500, 201];
    const delays: number[] = [];
    await sender({ baseDelayMs: 100, sleep: async (ms: number) => void delays.push(ms) }).send(makeSub("/b"), payload);
    expect(delays).toEqual([100, 200]);
  });
});

describe("config and payload", () => {
  it("fails with a clear error when VAPID env is missing", () => {
    expect(() => vapidFromEnv({})).toThrow(PushConfigError);
    expect(() => vapidFromEnv({ VAPID_SUBJECT: "mailto:a@b.c" })).toThrow(/VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY/);
  });

  it("reads VAPID from env", () => {
    const cfg = vapidFromEnv({ VAPID_SUBJECT: "mailto:a@b.c", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" });
    expect(cfg).toEqual({ subject: "mailto:a@b.c", publicKey: "pub", privateKey: "priv" });
  });

  it("builds a whitelisted payload and limits length", () => {
    const json = JSON.parse(buildPayload({ ...payload, title: "x".repeat(200) }));
    expect(Object.keys(json).sort()).toEqual(["body", "tag", "title", "type", "url"]);
    expect(json.title).toHaveLength(80);
    expect(json.tag).toBe("tahajud");
  });

  it("rejects absolute or protocol-relative urls", () => {
    expect(() => buildPayload({ ...payload, url: "https://evil.test" })).toThrow(RangeError);
    expect(() => buildPayload({ ...payload, url: "//evil.test" })).toThrow(RangeError);
  });
});
