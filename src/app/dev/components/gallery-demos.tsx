"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/sheet";

export function LoadingButtonDemo() {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={loading}
      onClick={() => {
        setLoading(true);
        window.setTimeout(() => setLoading(false), 1500);
      }}
    >
      {loading ? "Menyimpan" : "Simpan (coba loading)"}
    </Button>
  );
}

export function SheetDemo() {
  return (
    <Sheet
      title="Tandai berhalangan"
      description="Malam ini tidak dihitung dan progress level tetap aman."
      trigger={<Button variant="secondary">Buka sheet</Button>}
    >
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <SheetClose asChild>
          <Button>Tandai berhalangan</Button>
        </SheetClose>
        <SheetClose asChild>
          <Button variant="ghost">Batal</Button>
        </SheetClose>
      </div>
    </Sheet>
  );
}
