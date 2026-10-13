import {
  Activity,
  Building2,
  ContactRound,
  Handshake,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Percent,
  Send,
  TrendingUp,
  UserCheck,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";

// Navigation pilotée par la configuration : chaque entrée n'apparaît que si le rôle possède la permission.
// Masquer un lien n'est qu'un confort : l'accès réel est vérifié côté serveur par chaque page.
// Les modules de la phase 4 (comptes, opportunités, tâches, administration) s'ajoutent ici.

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  /** Page courante → l'entrée est-elle active ? Par défaut : le chemin commence par `href`. */
  match?: (pathname: string) => boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Pilotage",
    items: [
      {
        href: "/",
        label: "Tableau de bord",
        icon: LayoutDashboard,
        permission: "dashboard:read",
        match: (pathname) => pathname === "/",
      },
    ],
  },
  {
    label: "Clients",
    items: [
      { href: "/comptes", label: "Comptes", icon: Building2, permission: "account:read" },
      { href: "/contacts", label: "Contacts", icon: ContactRound, permission: "contact:read" },
      { href: "/opportunites", label: "Opportunités", icon: Handshake, permission: "opportunity:read" },
    ],
  },
  {
    label: "Suivi",
    items: [
      { href: "/taches", label: "Tâches", icon: ListChecks, permission: "task:read" },
      { href: "/activites", label: "Activités", icon: Activity, permission: "activity:read" },
    ],
  },
  {
    label: "Prospects",
    items: [
      {
        href: "/prospects",
        label: "Reporting prospect",
        icon: Users,
        permission: "prospect:read",
        // La liste, le formulaire de création et la fiche d'un prospect appartiennent à cet écran.
        match: (pathname) =>
          pathname === "/prospects" ||
          pathname === "/prospects/nouveau" ||
          new RegExp(`^/prospects/${UUID}`).test(pathname),
      },
      { href: "/prospects/qualifies", label: "Prospects qualifiés", icon: UserCheck, permission: "prospect:read" },
      { href: "/prospects/propositions", label: "Propositions envoyées", icon: Send, permission: "prospect:read" },
      { href: "/prospects/pipeline", label: "Valeur du pipeline", icon: TrendingUp, permission: "prospect:read" },
      { href: "/prospects/gagnes", label: "Taux de transformation", icon: Percent, permission: "prospect:read" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/utilisateurs", label: "Utilisateurs", icon: UserCog, permission: "user:manage" },
      { href: "/admin/demandes", label: "Demandes de réinitialisation", icon: KeyRound, permission: "user:manage" },
      { href: "/admin/equipes", label: "Équipes", icon: UsersRound, permission: "user:manage" },
      { href: "/admin/automatisations", label: "Automatisations", icon: Workflow, permission: "settings:manage" },
    ],
  },
];
