"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useAdmin } from "./admin-gate";
import { adminFetch, errorText, fmtDate, fmtMoney, useAdminGet } from "./api";
import {
  Definition, Empty, EntitlementTag, Field, Load, Notice, PAYMENT_LABEL, PageTitle, QUARANTINE_LABEL, ReasonForm, RowLink, Section, ShownOnce, Tag,
  VERIFIED_LABEL, inputClass,
} from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------- search ----------
export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = React.useState(q);
  const valid = q.trim().length >= 3;
  const state = useAdminGet<any>(valid ? `/search?q=${encodeURIComponent(q.trim())}` : null);
  return (
    <>
      <PageTitle title="Cari pembeli" description="Cari dengan email, nomor order Scalev, atau ID. Nomor HP tidak bisa dicari: hanya hash-nya yang disimpan." />
      <form
        role="search"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          router.replace(`/admin/users?q=${encodeURIComponent(text.trim())}`);
        }}
      >
        <div className="flex-1">
          <Field id="search-q" label="Email, nomor order, atau ID" hint="Minimal 3 karakter.">
            <input id="search-q" type="search" className={inputClass} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" aria-describedby="search-q-hint" />
          </Field>
        </div>
        <Button type="submit" disabled={text.trim().length < 3}>
          Cari
        </Button>
      </form>
      {!valid ? (
        <Empty title="Belum ada pencarian" hint="Ketik email pembeli atau nomor order dari Scalev untuk mulai." />
      ) : (
        <Load state={state}>
          {(r) => (
            <>
              <Section title={`Akun (${r.users.length})`}>
                {r.users.length === 0 ? <Empty title="Tidak ada akun yang cocok" hint="Pembeli yang belum aktivasi belum punya akun. Cek bagian order." /> : (
                  <ul className="flex flex-col gap-2">
                    {r.users.map((u: any) => (
                      <li key={u.user_id}>
                        <RowLink href={`/admin/users/${u.user_id}`}>
                          <span className="font-semibold break-all">{u.email}</span>
                          <span className="text-helper text-text-muted">{u.display_name ?? "tanpa nama"} · dibuat {fmtDate(u.created_at)}</span>
                        </RowLink>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title={`Order (${r.orders.length})`}>
                {r.orders.length === 0 ? <Empty title="Tidak ada order yang cocok" /> : <OrderRows orders={r.orders} />}
              </Section>
              <Section title={`Akses (${r.entitlements.length})`}>
                {r.entitlements.length === 0 ? <Empty title="Tidak ada akses yang cocok" /> : <EntitlementRows items={r.entitlements} />}
              </Section>
            </>
          )}
        </Load>
      )}
    </>
  );
}

function OrderRows({ orders }: { orders: any[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {orders.map((o) => (
        <li key={o.id}>
          <RowLink href={`/admin/purchases/${o.id}`}>
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">#{o.scalev_order_number ?? String(o.scalev_order_id).slice(0, 8)}</span>
              <Tag tone={o.payment_status === "paid" || o.payment_status === "settled" ? "good" : "warn"}>{PAYMENT_LABEL[o.payment_status] ?? o.payment_status}</Tag>
              {o.quarantine_reason ? <Tag tone="warn">{QUARANTINE_LABEL[o.quarantine_reason] ?? o.quarantine_reason}</Tag> : null}
              {o.activation_blocked ? <Tag tone="bad">Aktivasi diblokir</Tag> : null}
              {o.entitlement ? <EntitlementTag status={o.entitlement.status} /> : null}
            </span>
            <span className="text-helper text-text-muted break-all">
              {o.email ?? "tanpa email"}
              {o.amount != null ? ` · ${fmtMoney(o.amount, o.currency)}` : ""} · {fmtDate(o.created_at)}
            </span>
          </RowLink>
        </li>
      ))}
    </ul>
  );
}

function EntitlementRows({ items }: { items: any[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((e) => (
        <li key={e.id}>
          <RowLink href={e.order?.id ? `/admin/purchases/${e.order.id}` : e.user_id ? `/admin/users/${e.user_id}` : "/admin/entitlements"}>
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold break-all">{e.email}</span>
              <EntitlementTag status={e.status} />
              {e.entitlement_type === "staff_comp" ? <Tag tone="info">Staf</Tag> : null}
              {!e.has_account ? <Tag>Belum aktivasi</Tag> : null}
            </span>
            <span className="text-helper text-text-muted">Sejak {fmtDate(e.starts_at)}{e.transferred_from_email ? ` · dipindah dari ${e.transferred_from_email}` : ""}</span>
          </RowLink>
        </li>
      ))}
    </ul>
  );
}

// ---------- one account ----------
export function UserDetailView({ id }: { id: string }) {
  const state = useAdminGet<any>(`/users/${id}`);
  const me = useAdmin();
  const [link, setLink] = React.useState<{ link: string; expires_at: string } | null>(null);
  return (
    <Load state={state}>
      {(d) => (
        <>
          <PageTitle title={d.user.email} description={`${d.user.display_name ?? "Tanpa nama"} · dibuat ${fmtDate(d.user.created_at)}`} actions={<Link href="/admin/users" className="font-semibold underline">Kembali ke pencarian</Link>} />
          <div className="flex flex-wrap gap-2">
            <Tag tone={d.user.has_password ? "good" : "warn"}>{d.user.has_password ? "Sudah punya password" : "Belum punya password"}</Tag>
            {d.user.is_staff ? <Tag tone="info">Akun staf</Tag> : null}
            {d.user.is_admin ? <Tag tone="info">Punya peran admin</Tag> : null}
          </div>
          <p className="max-w-prose text-helper text-text-muted">Halaman ini hanya memuat akun, akses, dan order. Catatan ibadah tidak pernah tampil di admin.</p>

          <Section title="Akses">{d.entitlements.length === 0 ? <Empty title="Belum ada akses" /> : <EntitlementRows items={d.entitlements} />}</Section>
          <Section title="Order">{d.orders.length === 0 ? <Empty title="Tidak ada order" hint="Akun staf tidak punya order." /> : <OrderRows orders={d.orders} />}</Section>

          {me.can["support.reset_link"] ? (
            <Section title="Tautan atur password" description="Untuk pembeli atau staf yang lupa password dan tidak bisa pakai email + HP. Kamu kirim sendiri lewat WhatsApp. Semua perangkat lamanya keluar setelah tautan dipakai.">
              {link ? (
                <ShownOnce link={link.link} expiresAt={link.expires_at} who={d.user.email} onClose={() => setLink(null)} />
              ) : (
                <ReasonForm
                  id="user-reset"
                  buttonLabel="Buat tautan sekali pakai"
                  reasonLabel="Alasan membuat tautan"
                  onSubmit={async ({ reason }) => {
                    setLink(await adminFetch("POST", `/users/${id}/reset-link`, { reason }));
                  }}
                />
              )}
            </Section>
          ) : null}

          <History rows={d.history} />
        </>
      )}
    </Load>
  );
}

function History({ rows }: { rows: any[] }) {
  if (!rows?.length) return null;
  return (
    <Section title="Riwayat tindakan admin">
      <ul className="flex flex-col gap-2">
        {rows.map((h) => (
          <li key={h.id} className="rounded-[var(--radius-control)] bg-surface-2 p-3">
            <p className="font-semibold">{ACTION_LABEL[h.action] ?? h.action}</p>
            <p className="text-helper text-text-muted">{fmtDate(h.occurred_at)} · {h.actor_email ?? "sistem"}</p>
            {h.reason ? <p className="mt-1">{h.reason}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const ACTION_LABEL: Record<string, string> = {
  "order.approved_manual": "Order disetujui manual",
  "order.activation_blocked": "Aktivasi diblokir",
  "order.activation_unblocked": "Blokir aktivasi dibuka",
  "order.phone_checked": "Nomor HP dicek",
  "entitlement.approved_manual": "Akses disetujui manual",
  "entitlement.suspended": "Akses ditangguhkan",
  "entitlement.revoked": "Akses dicabut",
  "entitlement.reactivated": "Akses diaktifkan lagi",
  "entitlement.transferred": "Akses dipindah ke email lain",
  "staff.created": "Akun staf dibuat",
  "staff.revoked": "Akses staf dicabut",
  password_reset_link_created: "Tautan atur password dibuat",
  "role.granted": "Peran diberikan",
  "role.revoked": "Peran dicabut",
  "mfa.reset": "Autentikator direset",
  "mfa.enrolled": "Autentikator dipasang",
  "job.requeued": "Job diulang",
  "content.draft_saved": "Draf disimpan",
  "content.submitted": "Diajukan untuk review",
  "content.approved": "Disetujui",
  "content.returned": "Dikembalikan ke draf",
  "content.published": "Dipublikasikan",
  "content.template_created": "Template dibuat",
};

// ---------- orders ----------
const FILTERS = [
  { key: "all", label: "Semua" },
  { key: "pending", label: "Menunggu verifikasi" },
  { key: "quarantine", label: "Karantina" },
  { key: "blocked", label: "Aktivasi diblokir" },
] as const;
const PAGE = 25;

export function OrdersView() {
  const router = useRouter();
  const params = useSearchParams();
  const filter = FILTERS.some((f) => f.key === params.get("filter")) ? params.get("filter")! : "all";
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => setOffset(0), [filter]);
  const state = useAdminGet<any[]>(`/orders?filter=${filter}&limit=${PAGE}&offset=${offset}`);
  return (
    <>
      <PageTitle title="Pembelian" description="Order dari Scalev. Karantina berarti sistem menahan akses sampai admin memutuskan." />
      <div role="tablist" aria-label="Filter order" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => router.replace(`/admin/purchases?filter=${f.key}`)}
            className={cn("min-h-11 rounded-full border px-4", filter === f.key ? "border-transparent bg-primary text-on-primary" : "border-border-strong bg-surface hover:bg-surface-2")}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Load state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title={offset > 0 ? "Tidak ada order lagi" : "Tidak ada order di filter ini"} hint={filter === "all" ? "Order muncul di sini setelah webhook Scalev masuk dan diverifikasi." : "Coba filter Semua."} />
          ) : (
            <>
              <OrderRows orders={rows} />
              <div className="flex gap-2">
                <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Sebelumnya</Button>
                <Button variant="secondary" disabled={rows.length < PAGE} onClick={() => setOffset(offset + PAGE)}>Berikutnya</Button>
              </div>
            </>
          )
        }
      </Load>
    </>
  );
}

// ---------- one order ----------
export function OrderDetailView({ id }: { id: string }) {
  const state = useAdminGet<any>(`/orders/${id}`);
  const me = useAdmin();
  return (
    <Load state={state} rows={4}>
      {(d) => {
        const o = d.order;
        const ent = d.entitlements[0];
        return (
          <>
            <PageTitle title={`Order #${o.scalev_order_number ?? String(o.scalev_order_id).slice(0, 8)}`} description={o.email ?? "Order tanpa email"} actions={<Link href="/admin/purchases" className="font-semibold underline">Kembali ke daftar</Link>} />
            <div className="flex flex-wrap gap-2">
              <Tag tone={o.payment_status === "paid" || o.payment_status === "settled" ? "good" : "warn"}>{PAYMENT_LABEL[o.payment_status] ?? o.payment_status}</Tag>
              {ent ? <EntitlementTag status={ent.status} /> : <Tag tone="warn">Belum ada akses</Tag>}
              {o.activation_blocked ? <Tag tone="bad">Aktivasi diblokir</Tag> : null}
              {d.account ? <Tag tone="good">Sudah aktivasi</Tag> : <Tag>Belum aktivasi</Tag>}
            </div>

            {o.quarantine_reason ? (
              <Notice tone="warn" role="status">
                <p className="font-semibold">Order ditahan: {QUARANTINE_LABEL[o.quarantine_reason] ?? o.quarantine_reason}</p>
                <p className="mt-1">
                  {o.quarantine_reason === "post_payment_change" ? "Akses pembeli tetap aktif. Putuskan apakah akses perlu ditangguhkan di halaman Akses." : "Tidak ada akses yang dibuat sampai admin menyetujui."}
                </p>
              </Notice>
            ) : null}

            <Section title="Detail order">
              <Definition
                items={[
                  { label: "Email", value: o.email ?? "tidak ada" },
                  { label: "Nama pembeli", value: o.buyer_name ?? "tidak ada" },
                  { label: "Nomor HP", value: o.phone_on_file ? "Tersimpan sebagai hash. Tidak bisa ditampilkan." : "Tidak ada di order" },
                  { label: "Nominal", value: fmtMoney(o.amount, o.currency) },
                  { label: "Status Scalev", value: o.scalev_status ?? "-" },
                  { label: "Verifikasi", value: o.verified_via ? VERIFIED_LABEL[o.verified_via] ?? o.verified_via : "Belum" },
                  { label: "Diverifikasi", value: fmtDate(o.payment_verified_at) },
                  { label: "ID Scalev", value: <span className="font-mono text-helper break-all">{o.scalev_order_id}</span> },
                ]}
              />
              {d.items.length ? (
                <p className="text-helper text-text-muted">
                  Item: {d.items.map((i: any) => `${i.variant_sku ?? i.variant_id ?? "varian"} x${i.quantity}`).join(", ")}
                </p>
              ) : null}
            </Section>

            {d.account ? (
              <Section title="Akun pembeli">
                <p>
                  Akun sudah dibuat. {d.account.has_password ? "Sudah punya password." : "Belum punya password."}{" "}
                  <Link className="font-semibold underline" href={`/admin/users/${d.account.user_id}`}>
                    Buka akun
                  </Link>{" "}
                  untuk membuat tautan atur password.
                </p>
              </Section>
            ) : o.phone_on_file ? null : (
              ent && ent.status === "active" && (
                <Notice tone="warn" role="status">
                  Order ini tidak punya nomor HP, jadi pembeli belum bisa aktivasi sendiri. Pertanyaan untuk owner: bagaimana CS membantu kasus ini (lihat laporan X2-B).
                </Notice>
              )
            )}

            {d.events.length ? (
              <Section title="Kejadian dari Scalev" description="Status pemrosesan webhook untuk order ini. Isi webhook tidak ditampilkan.">
                <ul className="flex flex-col gap-1">
                  {d.events.map((e: any) => (
                    <li key={e.id} className="flex flex-wrap justify-between gap-2 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2">
                      <span>{e.event_type} · <span className="font-semibold">{EVENT_STATUS[e.process_status] ?? e.process_status}</span>{e.error_message ? ` (${e.error_message})` : ""}</span>
                      <span className="text-helper text-text-muted">{fmtDate(e.received_at)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {me.can["support.write"] ? <OrderActions d={d} onChanged={state.reload} /> : null}
            {me.can["support.phone"] ? <PhoneCheck id={id} on={o.phone_on_file} /> : null}
            <History rows={d.history} />
          </>
        );
      }}
    </Load>
  );
}

const EVENT_STATUS: Record<string, string> = { received: "diterima", processing: "diproses", awaiting_order_verification: "menunggu verifikasi", done: "selesai", failed: "gagal", ignored: "diabaikan" };

function OrderActions({ d, onChanged }: { d: any; onChanged: () => void }) {
  const o = d.order;
  const reload = onChanged;
  return (
    <>
      {d.can_approve ? (
        <Section title="Setujui manual" description="Pakai kalau pembayaran sudah kamu cek di luar sistem (misalnya bukti transfer) atau kamu memutuskan melepas order yang ditahan. Akses aktif setelah ini dan order tidak ditimpa lagi oleh data Scalev.">
          <ReasonForm
            id="order-approve"
            buttonLabel="Setujui dan beri akses"
            fields={[{ key: "ref", label: "Referensi persetujuan", hint: "Contoh: ID bukti transfer atau nomor tiket CS.", required: true }]}
            onSubmit={async ({ reason, extra }) => {
              await adminFetch("POST", `/orders/${o.id}/approve`, { reason, approval_reference: extra.ref });
            }}
            onDone={reload}
          />
          {!o.phone_on_file ? <p className="text-helper text-text-muted">Order ini tanpa nomor HP: pembeli tidak bisa aktivasi sendiri setelah disetujui.</p> : null}
        </Section>
      ) : null}
      <Section
        title={o.activation_blocked ? "Buka blokir aktivasi" : "Blokir aktivasi"}
        description={o.activation_blocked ? "Pembeli tidak bisa aktivasi atau reset sendiri dengan order ini. Buka blokir kalau sudah aman." : "Pakai kalau order dicurigai (misalnya email dan HP bocor). Pembeli tidak bisa aktivasi atau reset sendiri dengan order ini. Akses yang sudah aktif tidak berubah."}
      >
        <ReasonForm
          id="order-block"
          buttonLabel={o.activation_blocked ? "Buka blokir" : "Blokir aktivasi"}
          danger={!o.activation_blocked}
          onSubmit={async ({ reason }) => {
            await adminFetch("POST", `/orders/${o.id}/activation-block`, { blocked: !o.activation_blocked, reason });
          }}
          onDone={reload}
        />
      </Section>
    </>
  );
}

function PhoneCheck({ id, on }: { id: string; on: boolean }) {
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ match: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Section title="Cek nomor HP" description="Nomor asli tidak disimpan, jadi tidak bisa ditampilkan. Ketik nomor yang disebut pembeli dan sistem bilang cocok atau tidak. Setiap pengecekan tercatat di audit log (tanpa nomornya) dan dibatasi 5 kali per 15 menit.">
      {!on ? (
        <Notice tone="warn">Order ini tidak punya nomor HP.</Notice>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setResult(null);
            try {
              setResult(await adminFetch("POST", `/orders/${id}/phone-check`, { phone }));
            } catch (err) {
              setError(errorText(err));
            }
            setBusy(false);
            setPhone("");
          }}
        >
          <Field id="phone-check" label="Nomor HP yang disebut pembeli" hint="Boleh 0812..., +62812..., atau 62812....">
            <input id="phone-check" type="tel" inputMode="tel" autoComplete="off" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} aria-describedby="phone-check-hint" />
          </Field>
          {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}
          {result ? <Notice tone={result.match ? "good" : "warn"} role="status">{result.match ? "Cocok dengan nomor di order." : "Tidak cocok dengan nomor di order."}</Notice> : null}
          <div>
            <Button type="submit" variant="secondary" loading={busy} disabled={phone.trim().length < 8}>Cek nomor</Button>
          </div>
        </form>
      )}
    </Section>
  );
}

// ---------- entitlements ----------
const ENT_FILTERS = ["all", "pending_verification", "active", "suspended", "revoked", "expired"] as const;
export function EntitlementsView() {
  const [status, setStatus] = React.useState<(typeof ENT_FILTERS)[number]>("all");
  const [offset, setOffset] = React.useState(0);
  const state = useAdminGet<any[]>(`/entitlements?status=${status}&limit=${PAGE}&offset=${offset}`);
  const [open, setOpen] = React.useState<string | null>(null);
  const me = useAdmin();
  return (
    <>
      <PageTitle title="Akses" description="Siapa yang punya akses dan kenapa. Perubahan wajib beralasan dan tercatat." />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter status">
        {ENT_FILTERS.map((s) => (
          <button key={s} aria-pressed={status === s} onClick={() => { setStatus(s); setOffset(0); }} className={cn("min-h-11 rounded-full border px-4", status === s ? "border-transparent bg-primary text-on-primary" : "border-border-strong bg-surface hover:bg-surface-2")}>
            {s === "all" ? "Semua" : (s === "pending_verification" ? "Menunggu verifikasi" : s === "active" ? "Aktif" : s === "suspended" ? "Ditangguhkan" : s === "revoked" ? "Dicabut" : "Kedaluwarsa")}
          </button>
        ))}
      </div>
      <Load state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="Tidak ada akses di filter ini" />
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {rows.map((e) => (
                  <li key={e.id} className="rounded-[var(--radius-control)] border border-border bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="break-all font-semibold">{e.email}</span>
                          <EntitlementTag status={e.status} />
                          {e.entitlement_type === "staff_comp" ? <Tag tone="info">Staf</Tag> : null}
                          {!e.has_account ? <Tag>Belum aktivasi</Tag> : null}
                        </span>
                        <span className="text-helper text-text-muted">Sejak {fmtDate(e.starts_at)}{e.order ? ` · order ${e.order.scalev_order_id}` : ""}</span>
                      </div>
                      {me.can["support.write"] && e.entitlement_type !== "staff_comp" ? (
                        <Button variant="secondary" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                          {open === e.id ? "Tutup" : "Kelola"}
                        </Button>
                      ) : null}
                    </div>
                    {open === e.id ? <div className="border-t border-border p-4"><EntitlementManage e={e} onChanged={() => { setOpen(null); state.reload(); }} /></div> : null}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Sebelumnya</Button>
                <Button variant="secondary" disabled={rows.length < PAGE} onClick={() => setOffset(offset + PAGE)}>Berikutnya</Button>
              </div>
            </>
          )
        }
      </Load>
    </>
  );
}

function EntitlementManage({ e, onChanged }: { e: any; onChanged: () => void }) {
  const moves: { to: string; label: string; danger?: boolean }[] =
    e.status === "active" ? [{ to: "suspended", label: "Tangguhkan" }, { to: "revoked", label: "Cabut akses", danger: true }]
    : e.status === "suspended" ? [{ to: "active", label: "Aktifkan lagi" }, { to: "revoked", label: "Cabut akses", danger: true }]
    : e.status === "pending_verification" ? [{ to: "revoked", label: "Cabut akses", danger: true }] : [];
  const [tab, setTab] = React.useState<string>(e.status === "pending_verification" ? "approve" : moves[0]?.to ?? "transfer");
  const canTransfer = e.status === "active" || e.status === "pending_verification";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tindakan">
        {e.status === "pending_verification" ? <TabBtn id="approve" tab={tab} setTab={setTab}>Setujui</TabBtn> : null}
        {moves.map((m) => <TabBtn key={m.to} id={m.to} tab={tab} setTab={setTab}>{m.label}</TabBtn>)}
        {canTransfer ? <TabBtn id="transfer" tab={tab} setTab={setTab}>Pindah email</TabBtn> : null}
      </div>
      {tab === "approve" ? (
        <ReasonForm id={`ent-${e.id}-approve`} buttonLabel="Setujui akses" fields={[{ key: "ref", label: "Referensi persetujuan", required: true, hint: "Contoh: ID bukti transfer." }]} onSubmit={async ({ reason, extra }) => { await adminFetch("POST", `/entitlements/${e.id}/approve`, { reason, approval_reference: extra.ref }); }} onDone={onChanged} />
      ) : null}
      {moves.filter((m) => m.to === tab).map((m) => (
        <ReasonForm key={m.to} id={`ent-${e.id}-${m.to}`} buttonLabel={m.label} danger={m.danger} onSubmit={async ({ reason }) => { await adminFetch("POST", `/entitlements/${e.id}/status`, { to: m.to, reason }); }} onDone={onChanged} />
      ))}
      {tab === "transfer" ? (
        <ReasonForm id={`ent-${e.id}-transfer`} buttonLabel="Pindahkan akses" intro="Untuk salah ketik email saat order. Pemilik lama langsung kehilangan akses. Pemilik baru aktivasi dengan email baru dan nomor HP order yang sama." fields={[{ key: "to", label: "Email baru", required: true }]} onSubmit={async ({ reason, extra }) => { await adminFetch("POST", `/entitlements/${e.id}/transfer`, { to_email: extra.to, reason }); }} onDone={onChanged} />
      ) : null}
    </div>
  );
}

function TabBtn({ id, tab, setTab, children }: { id: string; tab: string; setTab: (t: string) => void; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("min-h-11 rounded-full border px-4", tab === id ? "border-transparent bg-primary-soft font-semibold" : "border-border-strong bg-surface hover:bg-surface-2")}>
      {children}
    </button>
  );
}
