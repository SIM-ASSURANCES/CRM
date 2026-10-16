#!/bin/sh
# Point d'entrée de l'image : applique les migrations de base de données, puis démarre le serveur.
#
#   RUN_MIGRATIONS=true (défaut) : exécute `prisma migrate deploy` avant le démarrage. Il n'applique QUE les migrations
#   déjà écrites et validées du dépôt, jamais de migration destructive automatique. Mettre `false` pour les désactiver
#   (par exemple après avoir pris une sauvegarde et préféré lancer la migration à la main).
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Migrations : application des migrations en attente…"
  ./node_modules/.bin/prisma migrate deploy
fi

echo "Démarrage du CRM sur ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec ./node_modules/.bin/next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
