"use client";

import * as React from "react";
import { createAuthLayer } from "@/data";
import type { AuthRepository } from "@/data";

/** One sign-in repository per screen. The mock keeps its state in IndexedDB, so instances agree. Swap for T1's provider when it lands. */
export function useAuthRepo(): AuthRepository | null {
  const [repo, setRepo] = React.useState<AuthRepository | null>(null);
  React.useEffect(() => setRepo(createAuthLayer()), []);
  return repo;
}
