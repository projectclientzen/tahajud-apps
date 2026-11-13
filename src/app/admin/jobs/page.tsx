import type { Metadata } from "next";

import { JobsView } from "@/components/admin/ops-views";

export const metadata: Metadata = { title: "Job" };

export default function Page() {
  return <JobsView />;
}
