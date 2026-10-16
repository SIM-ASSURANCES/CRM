#!/bin/sh
# Point d'entrée de l'image : tout est automatique au déploiement.
#
#   1. Migrations de base de données (RUN_MIGRATIONS=true par défaut) : `prisma migrate deploy` n'applique QUE les
#      migrations déjà écrites et validées du dépôt, jamais de migration destructive automatique. `false` pour les
#      désactiver (par exemple après une sauvegarde, pour les lancer à la main).
#   2. Premier administrateur (BOOTSTRAP_ADMIN=true par défaut) : créé s'il n'existe pas, SANS effet s'il existe déjà
#      (un compte existant n'est jamais modifié).
#        - SEED_ADMIN_PASSWORD renseigné : ce mot de passe temporaire est utilisé.
#        - sinon : un mot de passe temporaire aléatoire est généré et affiché UNE SEULE FOIS dans ces journaux, au tout
#          premier démarrage. Dans les deux cas, le changement est exigé à la première connexion.
#      Un échec ici n'empêche jamais l'application de démarrer.
#   3. Démarrage du serveur.
set -e

bootstrap_admin() {
  [ "${BOOTSTRAP_ADMIN:-true}" = "true" ] || return 0
  [ -n "${SEED_ADMIN_EMAIL:-}" ] || return 0
  : "${SEED_ADMIN_NAME:=Administrateur CRM}"
  export SEED_ADMIN_NAME

  generated=false
  if [ -z "${SEED_ADMIN_PASSWORD:-}" ]; then
    # Lettres et chiffres uniquement (politique de mot de passe de l'application), 20 caractères.
    SEED_ADMIN_PASSWORD="Tmp$(node -e "process.stdout.write(require('crypto').randomBytes(9).toString('hex'))")9a"
    generated=true
  fi
  export SEED_ADMIN_PASSWORD

  echo "Administrateur : vérification du compte ${SEED_ADMIN_EMAIL}…"
  if ! output="$(./node_modules/.bin/tsx --conditions=react-server prisma/seed.ts 2>&1)"; then
    echo "ATTENTION : la création de l'administrateur a échoué (l'application démarre quand même) :"
    echo "$output"
    return 0
  fi
  echo "$output"

  if [ "$generated" = "true" ] && echo "$output" | grep -q "Administrateur créé"; then
    echo "=================================================================="
    echo " PREMIER ADMINISTRATEUR CRÉÉ (affiché une seule fois)"
    echo "   Identifiant  : ${SEED_ADMIN_EMAIL}"
    echo "   Mot de passe : ${SEED_ADMIN_PASSWORD}"
    echo " Changement du mot de passe exigé à la première connexion."
    echo "=================================================================="
  fi
}

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Migrations : application des migrations en attente…"
  ./node_modules/.bin/prisma migrate deploy
fi

bootstrap_admin

echo "Démarrage du CRM sur ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec ./node_modules/.bin/next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
