import type { Metadata } from "next";
import { Suspense } from "react";
import { connectAction, disconnectAction, excludedDomainsAction, syncNowAction } from "@/app/(crm)/integrations/actions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import {
  CONNECTION_STATUS_LABELS,
  INITIAL_SYNC_DAYS,
  SYNC_KIND_LABELS,
  SYNC_STATUS_LABELS,
  SYNC_TRIGGER_LABELS,
  type ConnectionStatus,
} from "@/features/integrations/config";
import { getMyConnection, listConnectionsOverview, listMyEvents } from "@/features/integrations/connection";
import { getExcludedDomains } from "@/features/integrations/exclusions";
import { loadIntegrationSetup } from "@/features/integrations/setup";
import { can } from "@/lib/auth/permissions";
import { requirePermissionOrNotFound } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Messagerie" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const FLASH: Record<string, string> = {
  connected: "Votre messagerie est connectée. La première synchronisation se fera dans quelques minutes, ou tout de suite avec « Synchroniser maintenant ».",
  sync: "Synchronisation terminée : consultez le journal ci-dessous.",
  sync_partielle: "Synchronisation partielle : la suite sera lue automatiquement. Consultez le journal ci-dessous.",
  disconnected: "Votre messagerie est déconnectée. Les activités déjà importées restent dans les dossiers.",
  domains: "Liste des domaines exclus enregistrée.",
};

const ERRORS: Record<string, string> = {
  config: "L'intégration Microsoft n'est pas encore activée sur ce CRM. Contactez l'administrateur.",
  refuse: "Vous avez refusé l'accès à votre messagerie : rien n'a été enregistré. Vous pouvez recommencer quand vous le souhaitez.",
  connexion: "La connexion à Microsoft a échoué. Recommencez ; si le problème persiste, contactez l'administrateur.",
  acces: "Vous n'avez pas accès à cette action.",
  deconnexion: "La déconnexion n'a pas pu être effectuée. Réessayez dans un instant.",
  domaines: "Un ou plusieurs domaines sont invalides (exemple attendu : banque.ci).",
  sync_echec: "La synchronisation a échoué : consultez le journal ci-dessous.",
  sync_trop_vite: "Une synchronisation vient d'avoir lieu. Patientez quelques secondes avant de relancer.",
  sync_inactive: "Votre messagerie n'est pas connectée : connectez-la ou reconnectez-la d'abord.",
};

const STATUS_STYLE: Record<ConnectionStatus, string> = {
  active: "bg-emerald-50 text-emerald-800",
  needs_reconnect: "bg-amber-50 text-amber-800",
  revoked: "bg-surface text-muted",
};

const EVENT_STYLE: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-800",
  partial: "bg-amber-50 text-amber-800",
  error: "bg-red-50 text-danger",
  running: "bg-amber-50 text-amber-800",
};

export default function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IntegrationsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function IntegrationsContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermissionOrNotFound("integration:connect");
  const params = await searchParams;
  const configured = loadIntegrationSetup() !== null;
  const isAdmin = can(user.role, "settings:manage");

  const canOverview = isAdmin || can(user.role, "audit:read");
  const [connection, events, excluded, overview] = await Promise.all([
    getMyConnection(user),
    listMyEvents(user),
    isAdmin ? getExcludedDomains() : Promise.resolve([] as string[]),
    canOverview ? listConnectionsOverview(user) : Promise.resolve([]),
  ]);

  const flashKey = first(params.ok);
  const errorKey = first(params.erreur);
  const flash = flashKey ? FLASH[flashKey] : undefined;
  const error = errorKey ? (ERRORS[errorKey] ?? "L'opération n'a pas pu être effectuée.") : undefined;

  const status = (connection?.status ?? "revoked") as ConnectionStatus;
  const isActive = connection?.status === "active";
  const needsReconnect = connection?.status === "needs_reconnect";

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Messagerie"
        description="Reliez votre boîte Microsoft 365 : les échanges avec vos contacts apparaissent automatiquement dans le fil d'activité des comptes concernés."
      />

      {flash && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {!configured && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
          L&apos;intégration Microsoft n&apos;est pas encore activée sur ce CRM.
          {isAdmin && " Renseignez MS_CLIENT_ID, MS_CLIENT_SECRET et TOKEN_ENCRYPTION_KEY (voir docs/INTEGRATION_MICROSOFT.md)."}
        </p>
      )}

      <section aria-labelledby="etat" className="space-y-4 rounded-2xl border border-line bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="etat" className="text-lg font-semibold text-ink">
            Microsoft 365 (Outlook)
          </h2>
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", STATUS_STYLE[status])}>
            {connection ? CONNECTION_STATUS_LABELS[status] : "Non connectée"}
          </span>
        </div>

        {needsReconnect && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-ink">
            <p className="font-semibold">Votre messagerie n&apos;est plus synchronisée.</p>
            <p className="mt-1 text-ink-soft">
              Microsoft a retiré l&apos;accès ou celui-ci a expiré (changement de mot de passe, consentement retiré…). Cliquez sur
              « Reconnecter » et acceptez la demande : vos messages reprendront là où ils s&apos;étaient arrêtés, sans doublon.
            </p>
          </div>
        )}

        {connection && connection.status !== "revoked" ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Compte connecté</dt>
              <dd className="font-medium text-ink">{connection.accountEmail ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Dernière synchronisation</dt>
              <dd className="font-medium text-ink">{connection.lastSyncAt ? formatDateTime(connection.lastSyncAt) : "Aucune pour le moment"}</dd>
            </div>
            <div>
              <dt className="text-muted">Dernière réussie</dt>
              <dd className="font-medium text-ink">{connection.lastSuccessAt ? formatDateTime(connection.lastSuccessAt) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Messages lus depuis le</dt>
              <dd className="font-medium text-ink">{formatDateTime(connection.syncSince)}</dd>
            </div>
            <div>
              <dt className="text-muted">Mise à jour</dt>
              <dd className="font-medium text-ink">{connection.realtime ? "Quasi immédiate (notifications Microsoft)" : "Toutes les 15 minutes environ"}</dd>
            </div>
            {connection.lastError && (
              <div className="sm:col-span-2">
                <dt className="text-muted">Dernier incident</dt>
                <dd className="text-danger">{connection.lastError}</dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="space-y-2 text-sm text-ink-soft">
            <p>
              En connectant votre messagerie, vous autorisez le CRM à lire <strong>uniquement les en-têtes</strong> de vos e-mails
              (objet, expéditeur, destinataires, date) : jamais leur contenu ni leurs pièces jointes, et rien n&apos;est jamais envoyé ni modifié
              dans votre boîte.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Seuls les échanges avec des contacts de vos comptes sont conservés ; les autres messages sont ignorés.</li>
              <li>Les messages marqués « personnel », « privé » ou « confidentiel » dans Outlook ne sont jamais importés.</li>
              <li>Les {INITIAL_SYNC_DAYS} derniers jours sont lus à la première synchronisation.</li>
              <li>Vous pouvez vous déconnecter à tout moment ; les activités déjà importées restent dans les dossiers.</li>
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {(!connection || connection.status === "revoked" || needsReconnect) && (
            <form action={connectAction}>
              <Button type="submit" disabled={!configured}>
                {needsReconnect ? "Reconnecter ma messagerie" : "Connecter ma messagerie Microsoft"}
              </Button>
            </form>
          )}
          {isActive && (
            <form action={syncNowAction}>
              <Button type="submit">Synchroniser maintenant</Button>
            </form>
          )}
          {connection && connection.status !== "revoked" && (
            <form action={disconnectAction}>
              <Button type="submit" variant="secondary">
                Déconnecter
              </Button>
            </form>
          )}
        </div>
      </section>

      <section aria-labelledby="journal" className="space-y-3">
        <h2 id="journal" className="text-lg font-semibold text-ink">
          Journal de synchronisation
        </h2>
        {events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
            Aucune synchronisation pour le moment.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <caption className="sr-only">Journal des synchronisations de votre messagerie</caption>
              <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Opération</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Déclenchement</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Lus</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Importés</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Ignorés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((event) => (
                  <tr key={event.id} className="align-top">
                    <td className="px-4 py-3 text-ink-soft">{formatDateTime(event.startedAt)}</td>
                    <td className="px-4 py-3 font-medium text-ink">{SYNC_KIND_LABELS[event.kind] ?? event.kind}</td>
                    <td className="px-4 py-3 text-ink-soft">{SYNC_TRIGGER_LABELS[event.trigger] ?? event.trigger}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", EVENT_STYLE[event.status] ?? EVENT_STYLE.running)}>
                        {SYNC_STATUS_LABELS[event.status] ?? event.status}
                      </span>
                      {event.error && <p className="mt-1 max-w-xs text-xs text-danger">{event.error}</p>}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-soft">{event.fetched}</td>
                    <td className="px-4 py-3 text-right text-ink-soft">{event.imported}</td>
                    <td className="px-4 py-3 text-right text-ink-soft">{event.skipped + event.duplicates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canOverview && (
        <section aria-labelledby="ensemble" className="space-y-3">
          <h2 id="ensemble" className="text-lg font-semibold text-ink">
            Vue d&apos;ensemble des connexions
          </h2>
          {overview.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
              Aucun utilisateur n&apos;a encore connecté sa messagerie.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <caption className="sr-only">État des connexions Microsoft de tous les utilisateurs</caption>
                <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Utilisateur</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Compte Microsoft</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Dernière réussite</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Dernier incident</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {overview.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-3">
                        <span className="font-medium text-ink">{row.userName}</span>
                        <span className="block text-xs text-muted">{row.userEmail}</span>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{row.accountEmail ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[row.status as ConnectionStatus] ?? STATUS_STYLE.revoked)}>
                          {CONNECTION_STATUS_LABELS[row.status as ConnectionStatus] ?? row.status}
                        </span>
                        {row.status === "active" && row.realtime && <span className="ml-2 text-xs text-muted">temps réel</span>}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{row.lastSuccessAt ? formatDateTime(row.lastSuccessAt) : "—"}</td>
                      <td className="max-w-xs px-4 py-3 text-xs text-danger">{row.lastError ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {isAdmin && (
        <section aria-labelledby="exclusions" className="space-y-3 rounded-2xl border border-line bg-white p-6">
          <h2 id="exclusions" className="text-lg font-semibold text-ink">
            Domaines exclus (administrateur)
          </h2>
          <p className="text-sm text-muted">
            Les échanges avec ces domaines (et leurs sous-domaines) ne sont jamais importés : messageries grand public, famille, partenaires non
            commerciaux. Un domaine par ligne.
          </p>
          <form action={excludedDomainsAction} className="space-y-3">
            <label htmlFor="domains" className="sr-only">
              Domaines exclus
            </label>
            <textarea
              id="domains"
              name="domains"
              rows={5}
              defaultValue={excluded.join("\n")}
              placeholder={"gmail.com\nyahoo.fr"}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
            />
            <Button type="submit">Enregistrer la liste</Button>
          </form>
        </section>
      )}
    </div>
  );
}
