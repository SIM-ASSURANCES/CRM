import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";
import { ContactForm } from "@/app/(crm)/contacts/_components/contact-form";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { getAccount } from "@/features/accounts/service";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Nouveau contact" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function NewContactPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewContactContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NewContactContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("contact:write");
  const accountParam = (await searchParams).compte;

  // Création depuis la fiche d'un compte : on vérifie que ce compte existe et est visible avant de proposer le rattachement.
  let account: { id: string; name: string } | undefined;
  if (typeof accountParam === "string" && z.uuid().safeParse(accountParam).success) {
    try {
      const detail = await getAccount(user, accountParam);
      if (!detail.archivedAt) account = { id: detail.id, name: detail.legalName };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Nouveau contact"
        description="Vérifiez d'abord qu'il n'existe pas déjà : un contact peut être rattaché à plusieurs comptes."
      />
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <ContactForm mode="create" account={account} initial={{ status: "active" }} />
      </div>
    </div>
  );
}
