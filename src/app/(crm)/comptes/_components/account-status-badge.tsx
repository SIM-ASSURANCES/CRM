import { ACCOUNT_STATUSES, labelOf } from "@/features/accounts/config";
import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  prospect: "bg-slate-100 text-ink-soft",
  client: "bg-emerald-50 text-emerald-700",
  partner: "bg-brand-50 text-brand-700",
  inactive: "bg-amber-50 text-amber-800",
};

export function AccountStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", TONES[status] ?? TONES.prospect)}>
      {labelOf(ACCOUNT_STATUSES, status)}
    </span>
  );
}
