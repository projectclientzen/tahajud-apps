import type { Metadata } from "next";
import { ActivitiesView } from "@/components/admin/content-views";

export const metadata: Metadata = { title: "Amalan" };

export default function Page() {
  return <ActivitiesView group="activities" />;
}
