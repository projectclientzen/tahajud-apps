"use client";

import { Download, MessageCircle } from "lucide-react";
import * as React from "react";
import { authErrorText } from "@/components/auth/auth-errors";
import { PasswordField } from "@/components/auth/password-field";
import { useAuth } from "@/components/providers/auth-provider";
import { errorMessage, useData } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import type { DataLayer } from "@/data";
import { checkPassword, PASSWORD_PROBLEM_MESSAGE } from "@/domain/auth";

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

/** Change password. Needs the current one. Every other device is signed out. */
function ChangePasswordCard() {
  const { auth, session } = useAuth();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const problem = next === "" ? null : checkPassword(next, { email: session?.user?.email });
  const mismatch = confirm !== "" && confirm !== next;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth || busy || problem || mismatch) return;
    setBusy(true);
    setMsg(null);
    try {
      await auth.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: "Password diganti. Perangkat lain sudah keluar." });
    } catch (err) {
      setMsg({ ok: false, text: authErrorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Ganti password</CardTitle>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <PasswordField id="cp-current" label="Password sekarang" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField
          id="cp-new"
          label="Password baru"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint="Minimal 10 karakter. Perangkat lain akan keluar."
          error={problem ? PASSWORD_PROBLEM_MESSAGE[problem] : null}
        />
        <PasswordField
          id="cp-confirm"
          label="Ulangi password baru"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={mismatch ? "Password belum sama." : null}
        />
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-text-muted" : "text-error"}>
            {msg.text}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          loading={busy}
          disabled={!auth || current === "" || next === "" || confirm === "" || Boolean(problem) || mismatch}
        >
          Ganti password
        </Button>
      </form>
    </Card>
  );
}

/** `csHref` is a wa.me link, or null when no CS number is configured. Self-service deletion is off for now. */
export function AccountScreen({ csHref = null }: { csHref?: string | null }) {
  const { layer } = useData();
  const { auth } = useAuth();
  const [email, setEmail] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

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

  return (
    <>
      <PageHeader title="Akun dan data" description={email ? `Masuk sebagai ${email}.` : undefined} />
      <div className="flex flex-col gap-6">
        <ChangePasswordCard />
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
          <CardTitle>Hapus data</CardTitle>
          <p className="text-text-muted">
            Akses mengikuti email pembelianmu, jadi akun belum bisa dihapus dari aplikasi. Mau datamu dihapus? Kirim
            permintaan ke CS.
          </p>
          {csHref ? (
            <a
              href={csHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary" }) + " self-start"}
            >
              <MessageCircle aria-hidden className="size-5" />
              Chat CS di WhatsApp
            </a>
          ) : null}
        </Card>
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-text-muted" : "text-error"}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </>
  );
}
