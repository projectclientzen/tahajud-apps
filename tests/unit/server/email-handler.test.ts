import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PgliteDb } from "@/server/db/pglite";
import { EMAIL_NOT_CONFIGURED } from "@/server/email";
import { queue } from "@/server/jobs/queue";
import { tick } from "@/server/jobs/tick";
import { createJobsDb, jobsByType, makeServices, resetJobsTables } from "./jobs-harness";

let db: PgliteDb;
beforeAll(async () => {
  db = await createJobsDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await resetJobsTables(db);
  await db.exec("delete from public.email_outbox");
});

async function outbox(status = "queued"): Promise<string> {
  const r = await db.exec(
    "insert into public.email_outbox (to_email, template_key, payload, status) values ('buyer@example.test', 'access_resend', '{\"x\":1}'::jsonb, $1) returning id",
    [status],
  );
  return r[0]!.id as string;
}

describe("send_email is a documented no-op (SCALEV-AUTH-PLAN §8.9)", () => {
  it("marks the outbox row failed with EMAIL_NOT_CONFIGURED, finishes the job, and sends nothing", async () => {
    const id = await outbox();
    await queue.enqueue(db, "send_email", { outbox_id: id });
    const t = await tick(makeServices(db));
    expect(t.run.byType.send_email).toBe(1);
    const row = (
      await db.exec(
        "select status, last_error, sent_at, provider_message_id, attempt_count from public.email_outbox where id = $1",
        [id],
      )
    )[0]!;
    expect(row).toEqual({
      status: "failed",
      last_error: EMAIL_NOT_CONFIGURED,
      sent_at: null,
      provider_message_id: null,
      attempt_count: 0,
    });
    expect((await jobsByType(db, "send_email"))[0]).toMatchObject({ status: "done" });
    expect(EMAIL_NOT_CONFIGURED).toBe("EMAIL_NOT_CONFIGURED");
  });

  it("does not touch a message that was already sent", async () => {
    const id = await outbox("sent");
    await queue.enqueue(db, "send_email", { outbox_id: id });
    await tick(makeServices(db));
    expect((await db.exec("select status, last_error from public.email_outbox where id = $1", [id]))[0]).toEqual({
      status: "sent",
      last_error: null,
    });
  });

  it("an unknown outbox id finishes quietly, and a job without an id fails once without retries", async () => {
    await queue.enqueue(db, "send_email", { outbox_id: "00000000-0000-4000-8000-0000000000aa" });
    await queue.enqueue(db, "send_email", { nope: true });
    await tick(makeServices(db));
    const jobs = await jobsByType(db, "send_email");
    expect(jobs.map((j) => j.status).sort()).toEqual(["done", "failed"]);
    expect(String(jobs.find((j) => j.status === "failed")!.last_error)).toContain("outbox_id");
  });

  it("running the same job twice is harmless", async () => {
    const id = await outbox();
    await queue.enqueue(db, "send_email", { outbox_id: id });
    await tick(makeServices(db));
    await queue.enqueue(db, "send_email", { outbox_id: id });
    await tick(makeServices(db));
    expect((await db.exec("select status, last_error from public.email_outbox where id = $1", [id]))[0]).toEqual({
      status: "failed",
      last_error: EMAIL_NOT_CONFIGURED,
    });
  });
});
