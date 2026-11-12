"use client";

import { BellRing, MapPinned, Smartphone, type LucideIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { NotificationSetup } from "@/components/onboarding/notification-setup";
import { InstallGuide } from "@/components/pwa/install-guide";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import type { Dashboard } from "@/data";
import { isStandalone } from "@/offline/platform";

type Key = Dashboard["setup_cards"][number]["key"];

const COPY: Record<Key, { icon: LucideIcon; title: string; text: string; action: string }> = {
  location: {
    icon: MapPinned,
    title: "Atur wilayah salat",
    text: "Jadwal Subuh mengikuti wilayahmu.",
    action: "Buka Pengaturan",
  },
  notifications: {
    icon: BellRing,
    title: "Aktifkan pengingat",
    text: "Pengingat tidur dan tahajud membantu bangun tepat waktu.",
    action: "Aktifkan",
  },
  install_app: {
    icon: Smartphone,
    title: "Pasang di layar utama",
    text: "Buka lebih cepat dan tetap bisa dipakai saat sinyal lemah.",
    action: "Lihat caranya",
  },
};

/** What only the browser knows: is the app installed, is the notification permission granted. */
function useDeviceState() {
  const [state, setState] = React.useState<{ installed: boolean; notifications: boolean } | null>(null);
  React.useEffect(() => {
    setState({
      installed: isStandalone({
        matchMedia: (q) => window.matchMedia(q),
        navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      }),
      notifications: typeof Notification !== "undefined" && Notification.permission === "granted",
    });
  }, []);
  return state;
}

/** Section I: setup steps that are not done yet. Steps skipped in onboarding come back here (PRD §6.2). */
export function SetupCards({ cards }: { cards: Dashboard["setup_cards"] }) {
  const device = useDeviceState();
  const todo = cards.filter((c) => {
    if (c.key === "install_app") return !c.done && !device?.installed;
    // A saved preference is not enough: without the browser permission nothing can arrive.
    if (c.key === "notifications") return !c.done || (device !== null && !device.notifications);
    return !c.done;
  });
  if (todo.length === 0) return null;
  return (
    <section aria-label="Pengaturan awal" className="flex flex-col gap-3">
      <h2 className="text-card-title font-semibold">Langkah berikutnya</h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {todo.map((c) => {
          const { icon: Icon, title, text, action } = COPY[c.key];
          return (
            <li key={c.key}>
              <Card as="div" className="flex h-full flex-col gap-2 bg-surface-2" data-testid={`setup-${c.key}`}>
                <Icon aria-hidden className="size-6" strokeWidth={1.75} />
                <p className="font-semibold">{title}</p>
                <p className="flex-1 text-text-muted">{text}</p>
                {c.key === "location" ? (
                  <Link href="/settings" className={buttonVariants({ variant: "secondary" })}>
                    {action}
                  </Link>
                ) : (
                  <Sheet
                    title={title}
                    description={text}
                    trigger={<Button variant="secondary">{action}</Button>}
                  >
                    {c.key === "notifications" ? <NotificationSetup /> : <InstallGuide />}
                  </Sheet>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
