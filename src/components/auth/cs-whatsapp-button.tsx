import { MessageCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { whatsappLink } from "@/lib/env";
import { cn } from "@/lib/cn";

/** WhatsApp to customer service. Renders nothing while NEXT_PUBLIC_CS_WHATSAPP is empty. */
export function CsWhatsappButton({
  message,
  label = "Hubungi CS di WhatsApp",
  className,
  number,
}: {
  message: string;
  label?: string;
  className?: string;
  /** Tests only. Production reads NEXT_PUBLIC_CS_WHATSAPP. */
  number?: string;
}) {
  const href = whatsappLink(message, number);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "secondary", block: true }), className)}
    >
      <MessageCircle aria-hidden className="size-5" />
      {label}
      <span className="sr-only"> (buka di tab baru)</span>
    </a>
  );
}
