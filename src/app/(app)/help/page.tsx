import type { Metadata } from "next";
import { HelpView } from "@/components/help/help-view";

export const metadata: Metadata = { title: "Bantuan" };

export default function Page() {
  return <HelpView csWhatsapp={process.env.NEXT_PUBLIC_CS_WHATSAPP} />;
}
