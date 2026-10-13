"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonClasses, Button } from "@/components/ui/button";
import type { CredentialResult } from "@/features/users/service";

/**
 * Affiche UNE fois le mot de passe temporaire à l'administrateur. Il vit uniquement dans l'état du formulaire,
 * en mémoire du navigateur : jamais dans l'URL, jamais enregistré, jamais journalisé.
 */
export function CredentialNotice({ credential, heading }: { credential: CredentialResult; heading: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(credential.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Presse-papiers indisponible : l'administrateur peut sélectionner le texte du champ.
    }
  }

  return (
    <section role="status" className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6">
      <h2 className="text-xl font-bold text-emerald-900">{heading}</h2>
      <p className="mt-2 text-sm text-ink">
        Transmettez ce mot de passe temporaire à <strong>{credential.name}</strong> ({credential.email}) par un canal
        sûr. <strong>Il ne sera plus jamais affiché.</strong> À sa prochaine connexion, l&apos;utilisateur devra choisir
        un nouveau mot de passe.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor="temporary-password" className="sr-only">
          Mot de passe temporaire
        </label>
        <input
          id="temporary-password"
          readOnly
          value={credential.temporaryPassword}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 w-full max-w-sm rounded-lg border border-emerald-300 bg-white px-3 font-mono text-base tracking-wide text-ink"
        />
        <Button variant="secondary" onClick={copy}>
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Copié" : "Copier"}
        </Button>
      </div>

      <div className="mt-5">
        <Link href="/admin/utilisateurs" className={buttonClasses("primary")}>
          Retour aux utilisateurs
        </Link>
      </div>
    </section>
  );
}
