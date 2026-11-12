import type { Metadata } from "next";
import { AccountScreen } from "@/components/settings/account-view";

export const metadata: Metadata = { title: "Akun dan data" };

export default function Page() {
  return <AccountScreen />;
}
