import type { Metadata } from "next";

import { RolesView } from "@/components/admin/ops-views";

export const metadata: Metadata = { title: "Peran admin" };

export default function Page() {
  return <RolesView />;
}
