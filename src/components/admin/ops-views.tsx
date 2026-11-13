"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useAdmin } from "./admin-gate";
import { adminFetch, fmtDate, useAdminGet } from "./api";
import { ACTION_LABEL } from "./support-views";
import { Definition, Empty, Field, Load, Notice, PageTitle, ReasonForm, Section, ShownOnce, Tag, inputClass } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------- staff accounts ----------
export function StaffView() {
  const state = useAdminGet<any[]>("/staff");
  const [link, setLink] = React.useState<{ link: string; expires_at: string; who: string } | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <>
      <PageTitle title="Staf" description="Akun tim NgajiGaes tanpa pembelian. Semua level terbuka, tidak dihitung di laporan pembeli. Kamu tidak menentukan password: staf membuatnya sendiri lewat tautan sekali pakai." />
      {link ? <ShownOnce link={link.link} expiresAt={link.expires_at} who={link.who} onClose={() => setLink(null)} /> : null}
      <Section title="Buat akun staf">
        <ReasonForm
          id="staff-create"
          buttonLabel="Buat akun dan tautan"
          intro="Setelah dibuat, tautan atur password tampil sekali di sini. Kirim ke staf lewat WhatsApp."
          fields={[
            { key: "email", label: "Email staf", required: true },
            { key: "name", label: "Nama (opsional)" },
          ]}
          reasonLabel="Alasan membuat akun"
          onSubmit={async ({ reason, extra }) => {
            const r = await adminFetch<{ link: string; expires_at: string }>("POST", "/staff", { email: extra.email, display_name: extra.name?.trim() || undefined, reason });
            setLink({ link: r.link, expires_at: r.expires_at, who: extra.email ?? "staf" });
          }}
          onDone={state.reload}
        />
      </Section>
      <Section title="Daftar staf">
        <Load state={state}>
          {(rows) =>
            rows.length === 0 ? <Empty title="Belum ada akun staf" hint="Buat akun pertama di atas." /> : (
              <ul className="flex flex-col gap-2">
                {rows.map((s) => (
                  <li key={s.entitlement_id} className="rounded-[var(--radius-control)] border border-border bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="break-all font-semibold">{s.email}</span>
                          <Tag tone={s.status === "active" ? "good" : "bad"}>{s.status === "active" ? "Aktif" : "Dicabut"}</Tag>
                          <Tag tone={s.has_password ? "good" : "warn"}>{s.has_password ? "Sudah punya password" : "Belum atur password"}</Tag>
                        </span>
                        <span className="text-helper text-text-muted">Dibuat {fmtDate(s.created_at)} oleh {s.granted_by_email ?? "-"}{s.revoked_at ? ` · dicabut ${fmtDate(s.revoked_at)}` : ""}</span>
                      </div>
                      {s.status === "active" ? (
                        <Button variant="secondary" aria-expanded={open === s.entitlement_id} onClick={() => setOpen(open === s.entitlement_id ? null : s.entitlement_id)}>
                          {open === s.entitlement_id ? "Tutup" : "Kelola"}
                        </Button>
                      ) : null}
                    </div>
                    {open === s.entitlement_id ? (
                      <div className="flex flex-col gap-6 border-t border-border p-4">
                        <div className="flex flex-col gap-2">
                          <h3 className="font-semibold">Tautan atur password baru</h3>
                          <ReasonForm id={`staff-${s.entitlement_id}-link`} buttonLabel="Buat tautan" intro="Tautan lama otomatis tidak berlaku." onSubmit={async ({ reason }) => {
                            const r = await adminFetch<{ link: string; expires_at: string }>("POST", `/users/${s.user_id}/reset-link`, { reason });
                            setLink({ ...r, who: s.email });
                            setOpen(null);
                          }} />
                        </div>
                        <div className="flex flex-col gap-2">
                          <h3 className="font-semibold">Cabut akses staf</h3>
                          <ReasonForm id={`staff-${s.entitlement_id}-revoke`} buttonLabel="Cabut akses" danger intro="Akses aplikasi staf berhenti. Akunnya tetap ada dan tetap tidak dihitung sebagai pembeli." onSubmit={async ({ reason }) => { await adminFetch("POST", `/staff/${s.entitlement_id}/revoke`, { reason }); }} onDone={() => { setOpen(null); state.reload(); }} />
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          }
        </Load>
      </Section>
    </>
  );
}

// ---------- jobs ----------
export function JobsView() {
  const state = useAdminGet<any>("/jobs");
  const me = useAdmin();
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <>
      <PageTitle title="Job" description="Pekerjaan latar belakang: notifikasi, jadwal salat, pemrosesan order Scalev. Pesan galat dibersihkan dari email." />
      <Load state={state}>
        {(j) => (
          <>
            <Section title="Status">
              {Object.keys(j.by_status).length === 0 ? <Empty title="Belum ada job" hint="Job muncul setelah worker atau cron berjalan." /> : (
                <Definition items={Object.entries(j.by_status).map(([k, v]) => ({ label: JOB_STATUS[k] ?? k, value: String(v) }))} />
              )}
              {j.oldest_overdue_seconds != null ? <Notice tone="warn">Job tertua yang terlambat menunggu {Math.round(j.oldest_overdue_seconds / 60)} menit. Pastikan worker atau cron berjalan.</Notice> : null}
            </Section>
            <Section title={`Bermasalah (${j.problems.length})`}>
              {j.problems.length === 0 ? <Empty title="Tidak ada job gagal" /> : (
                <ul className="flex flex-col gap-2">
                  {j.problems.map((p: any) => (
                    <li key={p.id} className="rounded-[var(--radius-control)] border border-border bg-surface">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.job_type}</span><Tag tone="bad">{JOB_STATUS[p.status] ?? p.status}</Tag></span>
                          <span className="text-helper text-text-muted">Percobaan {p.attempt_count} dari {p.max_attempts} · {fmtDate(p.run_after)}</span>
                          {p.last_error ? <span className="break-words text-helper">{p.last_error}</span> : null}
                        </div>
                        {me.can["jobs.requeue"] ? <Button variant="secondary" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Tutup" : "Ulangi"}</Button> : null}
                      </div>
                      {open === p.id ? <div className="border-t border-border p-4"><ReasonForm id={`job-${p.id}`} buttonLabel="Antrekan ulang" onSubmit={async ({ reason }) => { await adminFetch("POST", `/jobs/${p.id}/requeue`, { reason }); }} onDone={() => { setOpen(null); state.reload(); }} /></div> : null}
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
const JOB_STATUS: Record<string, string> = { queued: "Antre", running: "Berjalan", done: "Selesai", failed: "Gagal, akan diulang", dead: "Gagal permanen" };

// ---------- prayer times (from health) ----------
export function PrayerView() {
  const state = useAdminGet<any>("/health");
  return (
    <>
      <PageTitle title="Jadwal salat" description="Cakupan jadwal tersimpan per wilayah dan sumbernya. Tidak ada jadwal yang dikarang: kalau kosong, aplikasi menampilkan keadaan kosong." />
      <Load state={state}>
        {(h) => {
          const p = h.prayer;
          const card = h.cards.find((c: any) => c.key === "prayer");
          return (
            <>
              {card ? <Notice tone={card.state === "ok" ? "good" : card.state === "error" ? "bad" : "warn"} role="status">{card.summary}</Notice> : null}
              <Section title="Cakupan">
                <Definition items={[
                  { label: "Wilayah didukung", value: p.regions_supported },
                  { label: "Punya jadwal hari ini", value: p.covered_today },
                  { label: "Punya jadwal 3 hari ke depan", value: p.covered_3_days },
                  { label: "Perlu ditinjau", value: p.needs_review },
                  { label: "Sinkron terakhir", value: fmtDate(p.last_fetched_at) },
                ]} />
              </Section>
              <Section title="Sumber">
                {p.by_provider.length === 0 ? <Empty title="Belum ada jadwal tersimpan" hint="Atur PRAYER_PROVIDER lalu jalankan job prayer_sync." /> : (
                  <ul className="flex flex-col gap-2">
                    {p.by_provider.map((q: any) => <li key={q.provider} className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2">{q.provider}: {q.rows} baris, terakhir {fmtDate(q.last_fetched_at)}</li>)}
                  </ul>
                )}
              </Section>
            </>
          );
        }}
      </Load>
    </>
  );
}

// ---------- audit log ----------
export function AuditView() {
  const [before, setBefore] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<any[]>([]);
  const [last, setLast] = React.useState(false);
  const state = useAdminGet<{ entries: any[] }>(`/audit-logs?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`);
  React.useEffect(() => {
    if (state.data) {
      setRows((r) => (before ? [...r, ...state.data!.entries] : state.data!.entries));
      setLast(state.data.entries.length < 50);
    }
  }, [state.data, before]);
  return (
    <>
      <PageTitle title="Audit log" description="Catatan semua tindakan admin. Hanya bisa dibaca: tidak bisa diubah atau dihapus oleh siapa pun." />
      {state.error ? <Load state={state}>{() => null}</Load> : rows.length === 0 && !state.loading ? <Empty title="Belum ada catatan" /> : (
        <ul className="flex flex-col gap-2">
          {rows.map((e) => (
            <li key={e.id} className="rounded-[var(--radius-control)] bg-surface-2 p-3">
              <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{ACTION_LABEL[e.action] ?? e.action}</span><Tag>{e.entity_type}</Tag></p>
              <p className="text-helper text-text-muted">{fmtDate(e.occurred_at)} · {e.actor_email ?? "sistem"}</p>
              {e.reason ? <p className="mt-1">{e.reason}</p> : null}
              {e.approval_reference ? <p className="text-helper text-text-muted">Referensi: {e.approval_reference}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {state.loading ? <p role="status" className="text-text-muted">Memuat...</p> : null}
      {!state.loading && !last && rows.length > 0 ? <div><Button variant="secondary" onClick={() => setBefore(rows[rows.length - 1].occurred_at)}>Muat lebih lama</Button></div> : null}
    </>
  );
}

// ---------- roles ----------
const ROLE_OPTIONS = [
  { value: "super_admin", label: "Super admin" },
  { value: "content_admin", label: "Admin konten" },
  { value: "support_admin", label: "Admin CS" },
  { value: "reporting_admin", label: "Admin laporan" },
];
const ROLE_NAME = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

export function RolesView() {
  const state = useAdminGet<any[]>("/roles");
  const [role, setRole] = React.useState("support_admin");
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <>
      <PageTitle title="Peran admin" description="Hanya super admin. Akun harus sudah aktivasi atau dibuat sebagai staf dulu. Mencabut peran terakhir juga menghapus autentikatornya." />
      <Section title="Beri peran">
        <div className="flex flex-col gap-3">
          <Field id="role-pick" label="Peran">
            <select id="role-pick" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <ReasonForm id="role-grant" buttonLabel="Beri peran" fields={[{ key: "email", label: "Email akun", required: true }]} onSubmit={async ({ reason, extra }) => { await adminFetch("POST", "/roles/grant", { email: extra.email, role, reason }); }} onDone={state.reload} />
        </div>
      </Section>
      <Section title="Admin saat ini">
        <Load state={state}>
          {(rows) => (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.user_id} className="rounded-[var(--radius-control)] border border-border bg-surface">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="break-all font-semibold">{r.email}</span>
                      <span className="flex flex-wrap gap-1.5">{r.roles.map((x: string) => <Tag key={x}>{ROLE_NAME[x] ?? x}</Tag>)}<Tag tone={r.mfa === "verified" ? "good" : "warn"}>{r.mfa === "verified" ? "Autentikator aktif" : "Autentikator belum dipasang"}</Tag></span>
                    </div>
                    <Button variant="secondary" aria-expanded={open === r.user_id} onClick={() => setOpen(open === r.user_id ? null : r.user_id)}>{open === r.user_id ? "Tutup" : "Kelola"}</Button>
                  </div>
                  {open === r.user_id ? (
                    <div className="flex flex-col gap-6 border-t border-border p-4">
                      {r.roles.map((x: string) => (
                        <div key={x} className="flex flex-col gap-2">
                          <h3 className="font-semibold">Cabut: {ROLE_NAME[x] ?? x}</h3>
                          <ReasonForm id={`rev-${r.user_id}-${x}`} buttonLabel="Cabut peran" danger onSubmit={async ({ reason }) => { await adminFetch("POST", "/roles/revoke", { user_id: r.user_id, role: x, reason }); }} onDone={() => { setOpen(null); state.reload(); }} />
                        </div>
                      ))}
                      {r.mfa !== "none" ? (
                        <div className="flex flex-col gap-2">
                          <h3 className="font-semibold">Reset autentikator</h3>
                          <ReasonForm id={`mfa-${r.user_id}`} buttonLabel="Reset autentikator" danger intro="Untuk HP hilang. Orangnya memasang autentikator baru saat masuk berikutnya." onSubmit={async ({ reason }) => { await adminFetch("POST", "/roles/reset-mfa", { user_id: r.user_id, reason }); }} onDone={() => { setOpen(null); state.reload(); }} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Load>
      </Section>
    </>
  );
}
