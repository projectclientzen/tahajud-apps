"use client";

import { Download, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { errorMessage, useData } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { ApiError, type DataLayer } from "@/data";
import { Field, TextInput } from "./controls";

/** Everything the user's own screens can read. Real export (PRD §24.4) moves to the server in T3. */
export async function collectExport(layer: DataLayer) {
  const [profile, notification_preferences, quran_progress, session_history, calendar] = await Promise.all([
    layer.profile.getProfile(),
    layer.notifications.getPreferences(),
    layer.quran.getProgress(),
    layer.report.getSessionHistory(),
    layer.report.getCalendar(),
  ]);
  return {
    exported_at: new Date().toISOString(),
    demo: layer.mode === "mock",
    profile,
    notification_preferences,
    quran_progress,
    session_history: session_history.sessions,
    calendar: calendar.days,
  };
}

/** Mock mode resets the demo data. Live mode has no endpoint yet, so it says so instead of pretending. */
async function deleteAccount(layer: DataLayer): Promise<void> {
  const dev = "dev" in layer ? (layer as { dev: { reset(): Promise<void> } }).dev : null;
  if (!dev) throw new ApiError("NOT_AVAILABLE", "Hapus akun belum tersedia. Hubungi CS untuk menghapus akunmu.");
  await dev.reset();
}

export function AccountScreen() {
  const { layer, bump } = useData();
  const { auth } = useAuth();
  const [email, setEmail] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void auth?.getSession().then((s) => setEmail(s.user?.email ?? null));
  }, [auth]);

  async function download() {
    if (!layer) return;
    try {
      const data = await collectExport(layer);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `tahajud-data-${data.exported_at.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Data diunduh sebagai file JSON." });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }

  const matches = email !== null && typed.trim().toLowerCase() === email.toLowerCase();

  async function remove() {
    if (!layer || !auth) return;
    setBusy(true);
    try {
      await deleteAccount(layer);
      await auth.logout();
      bump();
      setOpen(false);
      setDone(true);
    } catch (e) {
      setOpen(false);
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <>
        <PageHeader title="Akun dan data" />
        <Card role="status" className="flex flex-col gap-3">
          <CardTitle>Permintaan hapus akun dicatat</CardTitle>
          <p>
            Data ibadah, profil, dan progress Al-Qur&apos;an dihapus dalam 30 hari. Catatan pembelian disimpan tanpa
            emailmu.
          </p>
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            Ke halaman awal
          </Link>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader title="Akun dan data" description={email ? `Masuk sebagai ${email}.` : undefined} />
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-3">
          <CardTitle>Unduh data</CardTitle>
          <p className="text-text-muted">
            Profil, preferensi, progress Al-Qur&apos;an, dan riwayat sesimu dalam satu file JSON.
          </p>
          <Button variant="secondary" className="self-start" onClick={download}>
            <Download aria-hidden className="size-5" />
            Unduh data (JSON)
          </Button>
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle>Hapus akun</CardTitle>
          <p className="text-text-muted">
            Data ibadah, profil, notifikasi, dan progress Al-Qur&apos;an dihapus dalam 30 hari. Catatan pembelian dan
            akses disimpan tanpa emailmu sesuai kebutuhan bisnis. Tindakan ini tidak bisa dibatalkan.
          </p>
          <Button variant="danger" className="self-start" onClick={() => setOpen(true)}>
            <Trash2 aria-hidden className="size-5" />
            Hapus akun
          </Button>
        </Card>
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-text-muted" : "text-error"}>
            {msg.text}
          </p>
        ) : null}
      </div>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Hapus akun?"
        description={email ? "Ketik ulang emailmu untuk melanjutkan." : "Masuk dulu supaya emailmu bisa dikonfirmasi."}
      >
        <Field htmlFor="confirm-email" label="Email akun">
          <TextInput
            id="confirm-email"
            type="email"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>
        <Button variant="danger" disabled={!matches} loading={busy} onClick={remove}>
          Hapus akun saya
        </Button>
      </Sheet>
    </>
  );
}
