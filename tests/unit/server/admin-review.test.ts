import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminEnv, type AdminEnv } from "./admin-harness";

let env: AdminEnv;
beforeAll(async () => {
  env = await createAdminEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

describe("content review workflow (four eyes, snapshots, whitelist)", () => {
  it("template: draft, submit, the author cannot approve, a second admin approves, publish turns it on", async () => {
    const { b: a } = await env.fullAdmin("konten-a@ngajigaes.test", ["content_admin"]);
    const { b: c } = await env.fullAdmin("konten-b@ngajigaes.test", ["content_admin"]);
    const made = await env.call(a, "POST", "/templates", { category: "bedtime_motivasi", title: "Tidur lebih awal", body: "Halo {nama}, istirahat dulu ya." });
    expect(made.status).toBe(200);
    const tid = made.body.template_id as string;
    const vid = made.body.version.id as string;
    // A draft is not live: the template stays off until the first publish (T7-4).
    expect((await env.db.exec("select is_active, review_status from public.notification_templates where id = $1::uuid", [tid]))[0]).toMatchObject({ is_active: false, review_status: "draft" });

    expect((await env.call(a, "POST", `/content-versions/${vid}/publish`)).status).toBe(409);
    expect((await env.call(a, "POST", `/content-versions/${vid}/submit`)).status).toBe(200);
    const self = await env.call(a, "POST", `/content-versions/${vid}/approve`, {});
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe("FOUR_EYES_REQUIRED");
    // The author's table row also refuses reviewer = submitter.
    expect((await env.call(a, "POST", `/content-versions/${vid}/publish`)).status).toBe(409);
    expect((await env.call(c, "POST", `/content-versions/${vid}/approve`, { note: "Sudah dicek" })).status).toBe(200);
    // The author cannot edit what is already in review/approved.
    expect((await env.call(a, "PUT", `/templates/${tid}/draft`, { patch: { title: "Ubah lagi" } })).status).toBe(409);
    const pub = await env.call(c, "POST", `/content-versions/${vid}/publish`);
    expect(pub.status).toBe(200);
    expect((await env.db.exec("select is_active, review_status, version from public.notification_templates where id = $1::uuid", [tid]))[0]).toMatchObject({ is_active: true, review_status: "published", version: 1 });
    const actions = (await env.call(a, "GET", `/audit-logs?entity_id=${tid}&limit=50`)).body.entries.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["content.template_created", "content.submitted", "content.approved", "content.published"]));
  });

  it("a returned version goes back to draft with the note, and only its author can edit it", async () => {
    const { b: a } = await env.fullAdmin("konten-c@ngajigaes.test", ["content_admin"]);
    const { b: r } = await env.fullAdmin("konten-d@ngajigaes.test", ["content_admin"]);
    const made = await env.call(a, "POST", "/templates", { category: "tahajud", title: "Bangun malam", body: "Waktunya {nama} bangun." });
    const vid = made.body.version.id as string;
    await env.call(a, "POST", `/content-versions/${vid}/submit`);
    expect((await env.call(r, "POST", `/content-versions/${vid}/return`, {})).status).toBe(400);
    const back = await env.call(r, "POST", `/content-versions/${vid}/return`, { note: "Terlalu panjang" });
    expect(back.body).toMatchObject({ status: "draft", review_note: "Terlalu panjang" });
    expect((await env.call(r, "PUT", `/templates/${made.body.template_id}/draft`, { patch: { title: "Punya orang lain" } })).status).toBe(403);
    expect((await env.call(a, "PUT", `/templates/${made.body.template_id}/draft`, { patch: { title: "Bangun malam 2" } })).status).toBe(200);
  });

  it("a stale draft cannot be published over a newer live version", async () => {
    const { b: a } = await env.fullAdmin("konten-e@ngajigaes.test", ["content_admin"]);
    const { b: r } = await env.fullAdmin("konten-f@ngajigaes.test", ["content_admin"]);
    const made = await env.call(a, "POST", "/templates", { category: "fajr", title: "Subuh", body: "Subuh sudah dekat." });
    const vid = made.body.version.id as string;
    await env.call(a, "POST", `/content-versions/${vid}/submit`);
    await env.call(r, "POST", `/content-versions/${vid}/approve`, {});
    // Someone moves the live template before this one is published.
    await env.db.exec("update public.notification_templates set version = 5 where id = $1::uuid", [made.body.template_id]);
    const pub = await env.call(r, "POST", `/content-versions/${vid}/publish`);
    expect(pub.status).toBe(409);
    expect(pub.body.error.details?.reason).toBe("stale_draft");
  });

  it("template text rules: no Arabic, no HTML, only {nama} and {level}", async () => {
    const { b: a } = await env.fullAdmin("konten-g@ngajigaes.test", ["content_admin"]);
    for (const body of ["بسم الله", "<b>hai</b>", "Halo {email}"]) {
      const r = await env.call(a, "POST", "/templates", { category: "tahajud", title: "Judul", body });
      expect(r.status, body).toBe(400);
    }
  });

  it("activities: Arabic text and every field outside the whitelist cannot be edited, and the stored Arabic never changes", async () => {
    const { b: a } = await env.fullAdmin("konten-h@ngajigaes.test", ["content_admin"]);
    const list = await env.call(a, "GET", "/activities?group=dhikr");
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    const act = list.body[0];
    const before = (await env.db.exec("select arabic_text, transliteration, meaning, source_classification from public.activity_definitions where id = $1::uuid", [act.id]))[0];
    for (const key of ["arabic_text", "transliteration", "meaning", "source_classification", "review_status", "activity_key", "activity_type"]) {
      const r = await env.call(a, "PUT", `/activities/${act.id}/draft`, { patch: { [key]: "x" } });
      expect(r.status, key).toBe(400);
      expect(JSON.stringify(r.body)).toContain("not_editable");
    }
    // Arabic script inside an allowed field is refused too.
    expect((await env.call(a, "PUT", `/activities/${act.id}/draft`, { patch: { description: "اللهم" } })).status).toBe(400);
    // The detail still reads the Arabic text, and nothing wrote to it.
    const detail = await env.call(a, "GET", `/activities/${act.id}`);
    expect(detail.body.arabic_text).toBe(before!.arabic_text);
    expect((await env.db.exec("select arabic_text, transliteration, meaning, source_classification from public.activity_definitions where id = $1::uuid", [act.id]))[0]).toEqual(before);
  });

  it("an activity change goes through the same four eyes and publishes only the allowed fields", async () => {
    const { b: a } = await env.fullAdmin("konten-i@ngajigaes.test", ["content_admin"]);
    const { b: r } = await env.fullAdmin("konten-j@ngajigaes.test", ["content_admin"]);
    const act = (await env.call(a, "GET", "/activities?group=activities")).body[0];
    const before = (await env.db.exec("select arabic_text from public.activity_definitions where id = $1::uuid", [act.id]))[0];
    const draft = await env.call(a, "PUT", `/activities/${act.id}/draft`, { patch: { description: "Deskripsi baru yang lebih jelas." }, note: "Perjelas deskripsi" });
    expect(draft.status).toBe(200);
    const vid = draft.body.id as string;
    expect((await env.call(a, "POST", `/content-versions/${vid}/submit`)).status).toBe(200);
    expect((await env.call(a, "POST", `/content-versions/${vid}/approve`, {})).body.error.code).toBe("FOUR_EYES_REQUIRED");
    expect((await env.call(r, "POST", `/content-versions/${vid}/approve`, {})).status).toBe(200);
    expect((await env.call(r, "POST", `/content-versions/${vid}/publish`)).status).toBe(200);
    expect((await env.db.exec("select description, arabic_text from public.activity_definitions where id = $1::uuid", [act.id]))[0]).toEqual({ description: "Deskripsi baru yang lebih jelas.", arabic_text: before!.arabic_text });
  });

  it("a support admin cannot read or change content, and a content admin cannot touch orders", async () => {
    const { b: s } = await env.fullAdmin("support-x@ngajigaes.test", ["support_admin"]);
    expect((await env.call(s, "GET", "/templates")).status).toBe(403);
    expect((await env.call(s, "POST", "/templates", { category: "tahajud", title: "a", body: "b" })).status).toBe(403);
    const { b: c } = await env.fullAdmin("content-x@ngajigaes.test", ["content_admin"]);
    expect((await env.call(c, "GET", "/orders")).status).toBe(403);
  });
});
