"use client";

import { Download, MessageCircle } from "lucide-react";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { errorMessage, useData } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import type { DataLayer } from "@/data";

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
