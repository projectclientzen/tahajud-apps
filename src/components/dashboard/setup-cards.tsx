import { BellRing, MapPinned, Smartphone, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Dashboard } from "@/data";

const COPY: Record<Dashboard["setup_cards"][number]["key"], { icon: LucideIcon; title: string; text: string }> = {
  location: { icon: MapPinned, title: "Atur wilayah salat", text: "Jadwal Subuh mengikuti wilayahmu." },
  notifications: {
    icon: BellRing,
    title: "Aktifkan pengingat",
    text: "Pengingat tidur dan tahajud membantu bangun tepat waktu.",
  },
  install_app: {
    icon: Smartphone,
    title: "Pasang di layar utama",
    text: "Buka lebih cepat dan tetap bisa dipakai saat sinyal lemah.",
  },
};

/** Section I: setup steps that are not done yet. The settings screens arrive in a later session, so these are labelled. */
export function SetupCards({ cards }: { cards: Dashboard["setup_cards"] }) {
  const todo = cards.filter((c) => !c.done);
  if (todo.length === 0) return null;
  return (
    <section aria-label="Pengaturan awal" className="flex flex-col gap-3">
      <h2 className="text-card-title font-semibold">Langkah berikutnya</h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {todo.map((c) => {
          const { icon: Icon, title, text } = COPY[c.key];
          return (
            <li key={c.key}>
              <Card as="div" className="flex h-full flex-col gap-2 bg-surface-2">
                <Icon aria-hidden className="size-6" strokeWidth={1.75} />
                <p className="font-semibold">{title}</p>
                <p className="text-text-muted">{text}</p>
                <p className="text-helper text-text-muted">Segera tersedia di Pengaturan.</p>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
