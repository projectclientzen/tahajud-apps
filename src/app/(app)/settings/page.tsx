import type { Metadata } from "next";
import { SettingsScreen } from "@/components/settings/settings-screen";

export const metadata: Metadata = { title: "Pengaturan" };

export default function Page() {
  return <SettingsScreen />;
}
