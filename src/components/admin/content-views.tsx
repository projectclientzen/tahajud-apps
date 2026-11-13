"use client";

import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { diffSnapshots } from "@/server/admin/rules/diff";
import { TEMPLATE_LIMITS, renderTemplate, PREVIEW_SAMPLE } from "@/server/admin/rules/text";
import { useAdmin } from "./admin-gate";
import { adminFetch, errorText, fmtDate, useAdminGet } from "./api";
import { Definition, Empty, Field, Load, Notice, PageTitle, ReasonForm, RowLink, Section, Tag, inputClass, type Tone } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const VERSION_LABEL: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draf", tone: "neutral" },
  in_review: { label: "Menunggu review", tone: "warn" },
  approved: { label: "Disetujui, siap publish", tone: "info" },
  published: { label: "Terbit", tone: "good" },
};
const TYPE_LABEL: Record<string, string> = { prayer: "Salat", checklist: "Checklist", quran: "Qur'an", dhikr: "Dzikir" };

// ---------- level and Qur'an overviews (read only) ----------
export function LevelsView() {
  const state = useAdminGet<any[]>("/levels");
  return (
    <>
      <PageTitle title="Level" description="Konfigurasi level yang berlaku. Angka malam wajib masih PROVISIONAL sampai owner menyetujui." />
      <Load state={state} rows={3}>
        {(levels) =>
          levels.length === 0 ? <Empty title="Belum ada level" hint="Jalankan seed database." /> : (
            <div className="flex flex-col gap-4">
              {levels.map((l) => (
                <article key={l.level_number} className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-card-title font-semibold">Level {l.level_number}: {l.title}</h2>
                    {l.provisional ? <Tag tone="warn">Provisional</Tag> : null}
                    {!l.is_active ? <Tag>Nonaktif</Tag> : null}
                  </div>
                  <Definition items={[
                    { label: "Malam sukses untuk naik", value: l.required_successful_nights },
                    { label: "Periode saran", value: `${l.suggested_period_nights} malam` },
                    { label: "Perkiraan durasi", value: `${l.estimated_duration_minutes} menit` },
                  ]} />
                  <ul className="flex flex-col gap-1">
                    {l.activities.map((a: any) => (
                      <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link className="underline" href={`/admin/${a.activity_type === "dhikr" ? "dhikr" : "activities"}/${a.id}`}>{a.title}</Link>
                        <span className="text-helper text-text-muted">{a.phase}{a.target_count ? ` · target ${a.target_count}` : ""}{a.required_for_completion ? " · wajib" : ""}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )
        }
      </Load>
    </>
  );
}

export function QuranContentView() {
  const state = useAdminGet<any>("/quran-content");
  return (
    <>
      <PageTitle title="Konten Qur'an" description="Hanya metadata dataset. Teks ayat tidak ditampilkan dan tidak bisa diubah dari admin." />
      <Load state={state}>
        {(q) => (
          <>
            <Section title="Kelengkapan">
              <Definition items={[
                { label: "Surah dimuat", value: `${q.surahs_loaded} dari 114` },
                { label: "Ayat dimuat", value: `${q.verses_loaded} dari ${q.verses_expected || "?"}` },
                { label: "Terjemahan dimuat", value: q.translations_loaded },
              ]} />
              {Number(q.verses_loaded) === 0 ? <Notice tone="warn">Dataset Tanzil belum diimpor. Layar Qur&apos;an menampilkan keadaan kosong, bukan ayat buatan.</Notice> : null}
            </Section>
            <Section title="Sumber dataset">
              {q.sources.length === 0 ? <Empty title="Belum ada sumber tercatat" hint="Jalankan pnpm import:quran dengan dataset terverifikasi." /> : (
                <ul className="flex flex-col gap-2">
                  {q.sources.map((s: any) => (
                    <li key={s.id} className="rounded-[var(--radius-control)] bg-surface-2 p-3">
                      <p className="font-semibold">{s.name} {s.version}</p>
                      <p className="text-helper text-text-muted">Diimpor {fmtDate(s.imported_at)} · SHA-256 <span className="font-mono break-all">{s.file_sha256}</span></p>
                      <p className="text-helper">{s.attribution}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </Load>
    </>
  );
}

// ---------- activities and dhikr ----------
export function ActivitiesView({ group }: { group: "activities" | "dhikr" }) {
  const state = useAdminGet<any[]>(`/activities?group=${group}`);
  return (
    <>
      <PageTitle title={group === "dhikr" ? "Dzikir" : "Amalan"} description={group === "dhikr" ? "Judul, deskripsi, referensi, dan satuan hitung. Teks Arab dikelola owner dan tidak bisa diubah di sini." : "Judul, deskripsi, dan referensi tiap amalan. Perubahan lewat draf, review orang kedua, lalu publish."} />
      <Load state={state} rows={5}>
        {(rows) =>
          rows.length === 0 ? <Empty title="Belum ada data" hint="Jalankan seed database." /> : (
            <ul className="flex flex-col gap-2">
              {rows.map((a) => (
                <li key={a.id}>
                  <RowLink href={`/admin/${group}/${a.id}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{a.title}</span>
                      <Tag>{TYPE_LABEL[a.activity_type] ?? a.activity_type}</Tag>
                      {a.open_version ? <Tag tone={VERSION_LABEL[a.open_version.status]?.tone}>{VERSION_LABEL[a.open_version.status]?.label}</Tag> : null}
                      {a.review_status !== "published" ? <Tag tone="warn">Review: {a.review_status}</Tag> : null}
                    </span>
                    <span className="text-helper text-text-muted">Level {a.levels.join(", ") || "-"} · versi terbit {a.published_version ?? 0}</span>
                  </RowLink>
                </li>
              ))}
            </ul>
          )
        }
      </Load>
    </>
  );
}

const ACTIVITY_FIELDS: { key: string; label: string; max: number; multiline?: boolean; dhikrOnly?: boolean }[] = [
  { key: "title", label: "Judul", max: 120 },
  { key: "description", label: "Deskripsi", max: 600, multiline: true },
  { key: "source_reference", label: "Referensi sumber", max: 300 },
  { key: "counter_unit", label: "Satuan hitung", max: 40, dhikrOnly: true },
];

export function ActivityDetailView({ id, group }: { id: string; group: "activities" | "dhikr" }) {
  const state = useAdminGet<any>(`/activities/${id}`);
  const me = useAdmin();
  return (
    <Load state={state} rows={4}>
      {(a) => {
        const base = a.open_snapshot ?? a.live;
        const open = a.versions.find((v: any) => ["draft", "in_review", "approved"].includes(v.status));
        const canWrite = me.can["content.write"];
        const editable = canWrite && (!open || (open.status === "draft" && open.submitted_by_email === me.email));
        return (
          <>
            <PageTitle title={a.live.title} description={`${TYPE_LABEL[a.activity_type] ?? a.activity_type} · kunci ${a.activity_key}`} actions={<Link href={`/admin/${group}`} className="font-semibold underline">Kembali ke daftar</Link>} />
            <div className="flex flex-wrap gap-2">
              <Tag tone="good">Versi terbit {a.published_version ?? 0}</Tag>
              {a.review_status !== "published" ? <Tag tone="warn">Status konten: {a.review_status}</Tag> : null}
              {open ? <Tag tone={VERSION_LABEL[open.status]?.tone}>{VERSION_LABEL[open.status]?.label}</Tag> : null}
            </div>

            {a.arabic_text ? (
              <Section title="Teks Arab" description="Dikelola owner. Dibaca saja: tidak ada kolom untuk mengubahnya di admin ini.">
                <p lang="ar" dir="rtl" className="arabic rounded-[var(--radius-card)] bg-surface-2 p-4 text-dhikr">{a.arabic_text}</p>
                <Definition items={[
                  { label: "Transliterasi", value: a.transliteration ?? "belum disediakan owner" },
                  { label: "Terjemahan", value: a.meaning ?? "belum disediakan owner" },
                  { label: "Klasifikasi sumber", value: a.source_classification ?? "unverified" },
                ]} />
              </Section>
            ) : null}

            {editable ? <ActivityDraftForm a={a} base={base} dhikr={a.activity_type === "dhikr"} onSaved={state.reload} /> : (
              <Section title="Teks yang bisa diubah"><Definition items={ACTIVITY_FIELDS.filter((f) => !f.dhikrOnly || a.activity_type === "dhikr").map((f) => ({ label: f.label, value: base[f.key] || "kosong" }))} /></Section>
            )}

            {open ? <VersionPanel versionId={open.id} onChanged={state.reload} /> : null}

            <Section title="Riwayat versi">
              {a.versions.length === 0 ? <Empty title="Belum ada perubahan lewat admin" /> : (
                <ul className="flex flex-col gap-1">
                  {a.versions.map((v: any) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2">
                      <span>Versi {v.version_number} · <Tag tone={VERSION_LABEL[v.status]?.tone}>{VERSION_LABEL[v.status]?.label ?? v.status}</Tag></span>
                      <span className="text-helper text-text-muted">{v.submitted_by_email}{v.reviewer_email ? ` → ${v.reviewer_email}` : ""} · {fmtDate(v.updated_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        );
      }}
    </Load>
  );
}

function ActivityDraftForm({ a, base, dhikr, onSaved }: { a: any; base: any; dhikr: boolean; onSaved: () => void }) {
  const fields = ACTIVITY_FIELDS.filter((f) => !f.dhikrOnly || dhikr);
  const [vals, setVals] = React.useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, base[f.key] ?? ""])));
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const changed = fields.filter((f) => (vals[f.key] ?? "") !== (base[f.key] ?? ""));
  return (
    <Section title="Ubah teks" description="Disimpan sebagai draf. Belum tampil ke pengguna sampai diajukan, disetujui admin lain, dan dipublikasikan.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await adminFetch("PUT", `/activities/${a.id}/draft`, { patch: Object.fromEntries(changed.map((f) => [f.key, vals[f.key]])), note: note.trim() || undefined });
            setMsg({ ok: true, text: "Draf tersimpan." });
            onSaved();
          } catch (err) {
            setMsg({ ok: false, text: errorText(err) });
          }
          setBusy(false);
        }}
      >
        {fields.map((f) => (
          <Field key={f.key} id={`act-${f.key}`} label={f.label} hint={`Maksimal ${f.max} karakter. Tanpa huruf Arab.`}>
            {f.multiline ? (
              <textarea id={`act-${f.key}`} className={`${inputClass} min-h-28 py-2`} maxLength={f.max} value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} aria-describedby={`act-${f.key}-hint`} />
            ) : (
              <input id={`act-${f.key}`} className={inputClass} maxLength={f.max} value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} aria-describedby={`act-${f.key}-hint`} />
            )}
          </Field>
        ))}
        <Field id="act-note" label="Catatan perubahan (opsional)">
          <input id="act-note" className={inputClass} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {msg ? <Notice tone={msg.ok ? "good" : "bad"} role={msg.ok ? "status" : "alert"}>{msg.text}</Notice> : null}
        <div><Button type="submit" loading={busy} disabled={changed.length === 0}>Simpan draf</Button></div>
      </form>
    </Section>
  );
}

/** One open version: what changed against live, and the next step for this person. Four eyes is enforced by the server. */
export function VersionPanel({ versionId, onChanged }: { versionId: string; onChanged: () => void }) {
  const state = useAdminGet<any>(`/content-versions/${versionId}`);
  const me = useAdmin();
  return (
    <Load state={state}>
      {(v) => {
        const mine = v.submitted_by_email === me.email;
        const changes = diffSnapshots(v.live, v.snapshot);
        const done = () => { state.reload(); onChanged(); };
        const act = (step: string, body?: unknown) => async () => { await adminFetch("POST", `/content-versions/${v.id}/${step}`, body); };
        return (
          <Section title={`Versi ${v.version_number}: ${VERSION_LABEL[v.status]?.label ?? v.status}`} description={`Dibuat oleh ${v.submitted_by_email}${v.reviewer_email ? `, disetujui ${v.reviewer_email}` : ""}.`}>
            {v.change_note ? <p>Catatan: {v.change_note}</p> : null}
            {v.review_note ? <Notice tone="info">Catatan review: {v.review_note}</Notice> : null}
            {changes.length === 0 ? <p className="text-text-muted">Belum ada perbedaan dari versi terbit.</p> : (
              <ul className="flex flex-col gap-2">
                {changes.map((c) => (
                  <li key={c.label} className="rounded-[var(--radius-control)] bg-surface-2 p-3">
                    <p className="font-semibold">{c.label}</p>
                    <p className="text-helper text-text-muted">Sekarang: {c.before}</p>
                    <p>Usulan: {c.after}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-4">
              {v.status === "draft" && mine ? <ReasonlessStep id={`v-${v.id}-submit`} label="Ajukan untuk review" onRun={act("submit")} onDone={done} /> : null}
              {v.status === "draft" && !mine ? <Notice>Draf ini milik {v.submitted_by_email}. Hanya dia yang bisa mengubah atau mengajukannya.</Notice> : null}
              {v.status === "in_review" && mine ? <Notice tone="warn">Kamu pembuat draf ini, jadi tidak bisa menyetujuinya. Minta admin lain.</Notice> : null}
              {v.status === "in_review" && !mine ? <NoteStep id={`v-${v.id}-approve`} label="Setujui" onRun={(note) => act("approve", { note: note || undefined })()} onDone={done} /> : null}
              {(v.status === "in_review" || v.status === "approved") ? <NoteStep id={`v-${v.id}-return`} label={mine ? "Tarik kembali ke draf" : "Kembalikan ke draf"} variant="secondary" required={!mine} onRun={(note) => act("return", { note: note || undefined })()} onDone={done} /> : null}
              {v.status === "approved" && !mine ? <ReasonlessStep id={`v-${v.id}-publish`} label="Publikasikan sekarang" onRun={act("publish")} onDone={done} /> : null}
              {v.status === "approved" && mine ? <Notice tone="warn">Pembuat draf tidak bisa mempublikasikan versinya sendiri.</Notice> : null}
            </div>
          </Section>
        );
      }}
    </Load>
  );
}

function ReasonlessStep({ id, label, onRun, onDone }: { id: string; label: string; onRun: () => Promise<void>; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}
      <div>
        <Button id={id} loading={busy} onClick={async () => { setBusy(true); setError(null); try { await onRun(); onDone(); } catch (e) { setError(errorText(e)); } setBusy(false); }}>{label}</Button>
      </div>
    </div>
  );
}

function NoteStep({ id, label, onRun, onDone, variant = "primary", required }: { id: string; label: string; onRun: (note: string) => Promise<void>; onDone: () => void; variant?: "primary" | "secondary"; required?: boolean }) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form className="flex flex-col gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(null); try { await onRun(note.trim()); onDone(); } catch (err) { setError(errorText(err)); } setBusy(false); }}>
      <Field id={`${id}-note`} label={required ? "Catatan untuk pembuat (wajib)" : "Catatan (opsional)"}>
        <input id={`${id}-note`} className={inputClass} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}
      <div><Button type="submit" variant={variant} loading={busy} disabled={required && !note.trim()}>{label}</Button></div>
    </form>
  );
}

// ---------- notification templates ----------
export function TemplatesView() {
  const state = useAdminGet<any>("/templates");
  const me = useAdmin();
  const [creating, setCreating] = React.useState(false);
  return (
    <>
      <PageTitle title="Notifikasi" description="Template pesan. Variabel yang boleh: {nama} dan {level}. Tanpa huruf Arab dan tanpa HTML. Template baru mati sampai versi pertamanya dipublikasikan." actions={me.can["templates.write"] ? <Button onClick={() => setCreating((c) => !c)} variant={creating ? "secondary" : "primary"}>{creating ? "Batal" : "Template baru"}</Button> : undefined} />
      {creating ? <CreateTemplate categories={state.data?.categories ?? []} onDone={() => { setCreating(false); state.reload(); }} /> : null}
      <Load state={state} rows={5}>
        {({ templates }) =>
          templates.length === 0 ? <Empty title="Belum ada template" hint="Buat template pertama, lalu ajukan untuk review." /> : (
            <ul className="flex flex-col gap-2">
              {templates.map((t: any) => (
                <li key={t.id}>
                  <RowLink href={`/admin/notifications/${t.id}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{t.title}</span>
                      <Tag tone={t.is_active ? "good" : "neutral"}>{t.is_active ? "Aktif" : "Nonaktif"}</Tag>
                      {t.open_version ? <Tag tone={VERSION_LABEL[t.open_version.status]?.tone}>{VERSION_LABEL[t.open_version.status]?.label}</Tag> : null}
                    </span>
                    <span className="text-helper text-text-muted">{t.body}</span>
                  </RowLink>
                </li>
              ))}
            </ul>
          )
        }
      </Load>
    </>
  );
}

function CreateTemplate({ categories, onDone }: { categories: { value: string; label: string }[]; onDone: () => void }) {
  const [category, setCategory] = React.useState(categories[0]?.value ?? "");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface-2 p-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(null); try { await adminFetch("POST", "/templates", { category, title, body }); onDone(); } catch (err) { setError(errorText(err)); } setBusy(false); }}>
      <Field id="tpl-category" label="Kategori">
        <select id="tpl-category" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>
      <Field id="tpl-title" label="Judul" hint={`Maksimal ${TEMPLATE_LIMITS.title} karakter.`}>
        <input id="tpl-title" className={inputClass} maxLength={TEMPLATE_LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby="tpl-title-hint" />
      </Field>
      <Field id="tpl-body" label="Isi pesan" hint={`Maksimal ${TEMPLATE_LIMITS.body} karakter. Boleh {nama} dan {level}.`}>
        <textarea id="tpl-body" className={`${inputClass} min-h-24 py-2`} maxLength={TEMPLATE_LIMITS.body} value={body} onChange={(e) => setBody(e.target.value)} aria-describedby="tpl-body-hint" />
      </Field>
      {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}
      <div><Button type="submit" loading={busy} disabled={!title.trim() || !body.trim()}>Simpan sebagai draf</Button></div>
    </form>
  );
}

export function TemplateDetailView({ id }: { id: string }) {
  const state = useAdminGet<any>(`/templates/${id}`);
  const me = useAdmin();
  return (
    <Load state={state} rows={4}>
      {(t) => {
        const open = t.versions.find((v: any) => ["draft", "in_review", "approved"].includes(v.status));
        const base = t.open_snapshot ?? t.live;
        const editable = me.can["templates.write"] && (!open || (open.status === "draft" && open.submitted_by_email === me.email));
        return (
          <>
            <PageTitle title={t.live.title} description={`Versi terbit ${t.version}`} actions={<Link href="/admin/notifications" className="font-semibold underline">Kembali ke daftar</Link>} />
            <div className="flex flex-wrap gap-2">
              <Tag tone={t.is_active ? "good" : "neutral"}>{t.is_active ? "Aktif" : "Nonaktif"}</Tag>
              {t.review_status !== "published" ? <Tag tone="warn">Belum pernah terbit</Tag> : null}
              {open ? <Tag tone={VERSION_LABEL[open.status]?.tone}>{VERSION_LABEL[open.status]?.label}</Tag> : null}
            </div>
            <Section title="Pratinjau di HP" description="Memakai contoh data (bukan pengguna sungguhan).">
              <Preview title={base.title} body={base.body} />
            </Section>
            {editable ? <TemplateDraftForm id={id} base={base} onSaved={state.reload} /> : null}
            {open ? <VersionPanel versionId={open.id} onChanged={state.reload} /> : null}
            {me.can["templates.write"] && t.review_status === "published" ? (
              <Section title={t.is_active ? "Matikan template" : "Aktifkan template"} description={t.is_active ? "Template yang mati tidak dipakai untuk notifikasi baru." : "Template aktif dipakai untuk notifikasi berikutnya."}>
                <ReasonForm id="tpl-active" buttonLabel={t.is_active ? "Matikan" : "Aktifkan"} danger={t.is_active} onSubmit={async ({ reason }) => { await adminFetch("POST", `/templates/${id}/active`, { active: !t.is_active, reason }); }} onDone={state.reload} />
              </Section>
            ) : null}
          </>
        );
      }}
    </Load>
  );
}

function Preview({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-sm rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label="Pratinjau notifikasi">
      <p className="text-helper text-text-muted">Tahajud Tracker · sekarang</p>
      <p className="font-semibold">{renderTemplate(title, PREVIEW_SAMPLE)}</p>
      <p>{renderTemplate(body, PREVIEW_SAMPLE)}</p>
    </div>
  );
}

function TemplateDraftForm({ id, base, onSaved }: { id: string; base: any; onSaved: () => void }) {
  const [title, setTitle] = React.useState(base.title);
  const [body, setBody] = React.useState(base.body);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const changed = title !== base.title || body !== base.body;
  return (
    <Section title="Ubah teks" description="Disimpan sebagai draf, lalu diajukan dan disetujui admin lain.">
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setMsg(null);
        try { await adminFetch("PUT", `/templates/${id}/draft`, { patch: { ...(title !== base.title ? { title } : {}), ...(body !== base.body ? { body } : {}) } }); setMsg({ ok: true, text: "Draf tersimpan." }); onSaved(); } catch (err) { setMsg({ ok: false, text: errorText(err) }); }
        setBusy(false);
      }}>
        <Field id="tpl-e-title" label="Judul" hint={`Maksimal ${TEMPLATE_LIMITS.title} karakter.`}>
          <input id="tpl-e-title" className={inputClass} maxLength={TEMPLATE_LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby="tpl-e-title-hint" />
        </Field>
        <Field id="tpl-e-body" label="Isi pesan" hint={`Maksimal ${TEMPLATE_LIMITS.body} karakter. Boleh {nama} dan {level}.`}>
          <textarea id="tpl-e-body" className={`${inputClass} min-h-24 py-2`} maxLength={TEMPLATE_LIMITS.body} value={body} onChange={(e) => setBody(e.target.value)} aria-describedby="tpl-e-body-hint" />
        </Field>
        {msg ? <Notice tone={msg.ok ? "good" : "bad"} role={msg.ok ? "status" : "alert"}>{msg.text}</Notice> : null}
        <div><Button type="submit" loading={busy} disabled={!changed}>Simpan draf</Button></div>
      </form>
    </Section>
  );
}

// ---------- the review queue ----------
export function ReviewView() {
  const acts = useAdminGet<any[]>("/activities?group=activities");
  const dhikr = useAdminGet<any[]>("/activities?group=dhikr");
  const tpl = useAdminGet<any>("/templates");
  const loading = (acts.loading && !acts.data) || (dhikr.loading && !dhikr.data) || (tpl.loading && !tpl.data);
  const error = acts.error ?? dhikr.error ?? tpl.error;
  const items = [
    ...(acts.data ?? []).map((a) => ({ kind: "Amalan", href: `/admin/activities/${a.id}`, title: a.title, v: a.open_version })),
    ...(dhikr.data ?? []).map((a) => ({ kind: "Dzikir", href: `/admin/dhikr/${a.id}`, title: a.title, v: a.open_version })),
    ...(tpl.data?.templates ?? []).map((t: any) => ({ kind: "Notifikasi", href: `/admin/notifications/${t.id}`, title: t.title, v: t.open_version })),
  ].filter((i) => i.v);
  const groups: [string, string, typeof items][] = [
    ["in_review", "Menunggu review", items.filter((i) => i.v.status === "in_review")],
    ["approved", "Disetujui, siap dipublikasikan", items.filter((i) => i.v.status === "approved")],
    ["draft", "Draf", items.filter((i) => i.v.status === "draft")],
  ];
  return (
    <>
      <PageTitle title="Review konten" description="Perubahan butuh dua orang: pembuat draf dan penyetuju harus berbeda." />
      {error ? <Notice tone="bad" role="alert">{errorText(error)}</Notice> : loading ? <p role="status" className="text-text-muted">Memuat...</p> : items.length === 0 ? (
        <Empty title="Tidak ada perubahan yang berjalan" hint="Buka Amalan, Dzikir, atau Notifikasi untuk membuat draf." />
      ) : groups.map(([key, label, rows]) => (
        <Section key={key} title={`${label} (${rows.length})`}>
          {rows.length === 0 ? <p className="text-text-muted">Kosong.</p> : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.href}>
                  <RowLink href={r.href}>
                    <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.title}</span><Tag>{r.kind}</Tag></span>
                    <span className="text-helper text-text-muted">Dibuat oleh {r.v.submitted_by_email}</span>
                  </RowLink>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ))}
    </>
  );
}
