import { MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { getAmalan, PHASES } from "@/domain/content";
import { LEVELS } from "@/domain/config/provisional";

const PHASE_LABEL = { night: "Malam", fajr: "Subuh", post_fajr: "Setelah Subuh" } as const;

/** Digits only, so the wa.me link cannot carry anything else. Empty hides the contact. */
export const csLink = (raw: string | undefined): string | null => {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
};

export function HelpView({ csWhatsapp }: { csWhatsapp?: string }) {
  const amalan = getAmalan();
  const cs = csLink(csWhatsapp);
  return (
    <>
      <PageHeader title="Bantuan" description="Referensi amalan, kebijakan, dan cara menghubungi CS." />
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-2 bg-surface-2">
          <CardTitle>Tentang syarat di aplikasi</CardTitle>
          <p>
            Syarat sesi tuntas adalah aturan aplikasi untuk membantu istiqomah. Ini bukan hukum fikih. Untuk pertanyaan
            ibadah, tanyakan ke guru atau pembimbingmu.
          </p>
        </Card>

        <section aria-labelledby="ref" className="flex flex-col gap-4">
          <h2 id="ref" className="text-card-title font-semibold">
            Referensi amalan
          </h2>
          {LEVELS.map((lv) => {
            const level = amalan.levels[lv];
            return (
              <Card key={lv} className="flex flex-col gap-4">
                <CardTitle>
                  Level {lv}: {level.title}
                </CardTitle>
                {PHASES.map((ph) => {
                  const items = level.activities.filter((a) => a.phase === ph);
                  if (items.length === 0) return null;
                  return (
                    <div key={ph} className="flex flex-col gap-2">
                      <h3 className="font-semibold">{PHASE_LABEL[ph]}</h3>
                      <ul className="flex flex-col gap-3">
                        {items.map((a) => {
                          const dhikr = a.dhikrRef ? amalan.dhikr[a.dhikrRef] : null;
                          return (
                            <li key={a.id} className="flex flex-col gap-1">
                              <p>
                                {a.title}
                                {a.target ? (
                                  <span className="text-text-muted">
                                    {" "}
                                    · {a.target} {a.unit ?? ""}
                                  </span>
                                ) : null}
                                {a.required ? null : <span className="text-text-muted"> · Opsional</span>}
                              </p>
                              {dhikr ? (
                                <p
                                  className="arabic rounded-[var(--radius-control)] bg-surface-2 p-3 text-start text-[1.5rem] leading-[2.1]"
                                  lang="ar"
                                  dir="rtl"
                                >
                                  {dhikr.arabicText}
                                </p>
                              ) : null}
                              {dhikr && dhikr.reviewStatus !== "published" ? (
                                <p className="text-helper text-text-muted">Teks ini belum selesai ditinjau.</p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </Card>
            );
          })}
          <p className="text-helper text-text-muted">
            Teks Arab dari konten yang disetujui owner, versi {amalan.contentVersion}. Transliterasi dan terjemahan
            belum tersedia.
          </p>
        </section>

        {cs ? (
          <Card className="flex flex-col gap-3">
            <CardTitle>Hubungi CS</CardTitle>
            <p className="text-text-muted">Kendala akses, pembayaran, atau akun? Kirim pesan ke CS lewat WhatsApp.</p>
            <a
              href={cs}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary" }) + " self-start"}
            >
              <MessageCircle aria-hidden className="size-5" />
              Chat CS di WhatsApp
            </a>
          </Card>
        ) : null}

        <Card className="flex flex-col gap-2">
          <CardTitle>Kebijakan privasi</CardTitle>
          <p className="w-fit rounded-full bg-warning-soft px-2.5 py-0.5 text-helper font-medium">Draf, belum final</p>
          <ul className="list-disc pl-5 text-text-muted">
            <li>Tidak ada leaderboard dan tidak ada data ibadahmu yang tampil ke pengguna lain.</li>
            <li>Alasan berhalangan tidak disimpan.</li>
            <li>Lokasi hanya berupa wilayah, bukan GPS.</li>
            <li>Kamu bisa mengunduh dan menghapus datamu di Pengaturan, Akun dan data.</li>
          </ul>
          <p className="text-helper text-text-muted">
            Teks kebijakan lengkap dan syarat ketentuan menyusul sebelum peluncuran.
          </p>
        </Card>
      </div>
    </>
  );
}
