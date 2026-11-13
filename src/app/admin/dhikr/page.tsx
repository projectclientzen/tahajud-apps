import type { Metadata } from "next";
import { ActivitiesView } from "@/components/admin/content-views";

export const metadata: Metadata = { title: "Dzikir" };

export default function Page() {
  return <ActivitiesView group="dhikr" />;
}
