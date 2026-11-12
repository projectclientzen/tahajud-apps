import type { Metadata } from "next";
import { NotificationCenter } from "@/components/notifications/notification-center";

export const metadata: Metadata = { title: "Notifikasi" };

export default function Page() {
  return <NotificationCenter />;
}
