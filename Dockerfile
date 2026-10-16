# syntax=docker/dockerfile:1
#
# Image de production du CRM (Next.js + Prisma). Construction en trois étapes :
#   deps    : installation des dépendances (couche mise en cache tant que package-lock.json ne change pas)
#   builder : génération du client Prisma puis `next build`
#   runner  : image d'exécution, utilisateur non-root, migrations appliquées au démarrage (voir docker-entrypoint.sh)
#
# Construire :  docker build -t ghcr.io/sim-assurances/crm:v0 .
# Voir docs/DEPLOIEMENT.md pour les variables d'environnement et le déploiement sur Dokploy.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# --- Dépendances -------------------------------------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- Compilation -------------------------------------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Valeurs FACTICES, uniquement pour que `next build` valide la forme de l'environnement : passées en ligne, elles n'existent
# que le temps de cette commande et ne sont pas conservées dans l'image. Les vraies valeurs sont fournies au démarrage du
# conteneur (voir docs/DEPLOIEMENT.md).
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=valeur-factice-de-compilation-0000000000 \
    BETTER_AUTH_URL=http://localhost:3000 \
    sh -c "npx prisma generate && npm run build"

# --- Exécution ---------------------------------------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Certificats racines (appels sortants : Microsoft Graph) et utilitaires minimaux.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Le CLI Prisma (migrations), tsx (création du premier administrateur) et TypeScript (next.config.ts) font partie de
# node_modules : l'image reste simple à exploiter, au prix de quelques dizaines de Mo.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/package.json /app/tsconfig.json /app/next.config.ts /app/prisma.config.ts ./
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
# Fins de ligne Unix quel que soit le poste qui construit l'image (Windows) + droit d'exécution.
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
