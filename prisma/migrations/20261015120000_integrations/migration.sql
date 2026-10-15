-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "external_provider" TEXT,
ADD COLUMN     "external_url" TEXT;

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "account_email" TEXT,
    "external_user_id" TEXT,
    "scopes" TEXT NOT NULL,
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "cursors" JSONB NOT NULL DEFAULT '{}',
    "sync_since" TIMESTAMPTZ(3) NOT NULL,
    "syncing_since" TIMESTAMPTZ(3),
    "sync_requested_at" TIMESTAMPTZ(3),
    "last_sync_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "subscription_id" TEXT,
    "subscription_expires_at" TIMESTAMPTZ(3),
    "webhook_secret" TEXT,
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_events" (
    "id" UUID NOT NULL,
    "connection_id" UUID,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "state" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE INDEX "integration_connections_provider_status_idx" ON "integration_connections"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_user_id_provider_key" ON "integration_connections"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_subscription_id_key" ON "integration_connections"("subscription_id");

-- CreateIndex
CREATE INDEX "sync_events_connection_id_started_at_idx" ON "sync_events"("connection_id", "started_at");

-- CreateIndex
CREATE INDEX "sync_events_user_id_started_at_idx" ON "sync_events"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contraintes d'intégrité des intégrations
ALTER TABLE "integration_connections"
  ADD CONSTRAINT "integration_connections_provider_check" CHECK ("provider" IN ('microsoft')),
  ADD CONSTRAINT "integration_connections_status_check" CHECK ("status" IN ('active', 'needs_reconnect', 'revoked')),
  -- Une connexion révoquée ne porte plus aucun jeton.
  ADD CONSTRAINT "integration_connections_tokens_check" CHECK (
    ("status" = 'revoked' AND "access_token_enc" IS NULL AND "refresh_token_enc" IS NULL)
    OR "status" <> 'revoked'
  );

ALTER TABLE "sync_events"
  ADD CONSTRAINT "sync_events_kind_check" CHECK ("kind" IN ('mail_sync', 'connected', 'disconnected', 'token_refresh', 'webhook', 'subscription')),
  ADD CONSTRAINT "sync_events_trigger_check" CHECK ("trigger" IN ('manual', 'schedule', 'webhook', 'system')),
  ADD CONSTRAINT "sync_events_status_check" CHECK ("status" IN ('running', 'success', 'partial', 'error'));

-- Dédoublonnage des activités synchronisées : un message n'est enregistré qu'une fois par auteur et par compte
-- (un même e-mail rattaché à plusieurs comptes donne une activité par compte, jamais deux sur le même compte).
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_external_pair_check" CHECK (("external_id" IS NULL) = ("external_provider" IS NULL));
CREATE UNIQUE INDEX "activities_external_unique" ON "activities" ("author_user_id", "external_provider", "external_id", "account_id") WHERE "external_id" IS NOT NULL;
