import type { Metadata } from "next";
import { AccountScreen } from "@/components/settings/account-view";
import { csLink } from "@/components/help/help-view";

export const metadata: Metadata = { title: "Akun dan data" };

export default function Page() {
  return <AccountScreen csHref={csLink(process.env.NEXT_PUBLIC_CS_WHATSAPP)} />;
}
