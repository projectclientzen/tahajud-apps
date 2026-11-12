import type { Metadata } from "next";
import { SessionView } from "@/components/worship/session-view";

export const metadata: Metadata = { title: "Sesi ibadah" };

export default function Page() {
  return <SessionView />;
}
