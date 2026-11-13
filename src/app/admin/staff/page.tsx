import type { Metadata } from "next";

import { StaffView } from "@/components/admin/ops-views";

export const metadata: Metadata = { title: "Staf" };

export default function Page() {
  return <StaffView />;
}
