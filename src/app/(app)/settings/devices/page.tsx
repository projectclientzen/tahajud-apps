import type { Metadata } from "next";
import { DevicesScreen } from "@/components/settings/devices-view";

export const metadata: Metadata = { title: "Perangkat aktif" };

export default function Page() {
  return <DevicesScreen />;
}
