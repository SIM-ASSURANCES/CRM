-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "contact_last_name" TEXT NOT NULL,
    "contact_first_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,
    "inserted_on" DATE NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'open',
    "product_id" UUID,
    "expected_revenue" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "loss_reason" TEXT,
    "loss_comment" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "owner_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "type" TEXT NOT NULL,
    "from_progress" INTEGER,
    "to_progress" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "expected_revenue" DECIMAL(18,2),

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "leads_owner_user_id_status_progress_idx" ON "leads"("owner_user_id", "status", "progress");

-- CreateIndex
CREATE INDEX "leads_status_progress_idx" ON "leads"("status", "progress");

-- CreateIndex
CREATE INDEX "leads_inserted_on_idx" ON "leads"("inserted_on");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "lead_events_lead_id_occurred_at_idx" ON "lead_events"("lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "lead_events_occurred_at_type_idx" ON "lead_events"("occurred_at", "type");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contraintes métier (parcours Excel et CDC section 14), appliquées au niveau de la base :
-- une règle oubliée dans l'application ne peut pas produire une donnée incohérente.
ALTER TABLE "leads" ADD CONSTRAINT "leads_progress_check" CHECK ("progress" IN (10, 20, 40, 60, 80, 90, 100));
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_check" CHECK ("status" IN ('open', 'won', 'lost'));
ALTER TABLE "leads" ADD CONSTRAINT "leads_inserted_on_check" CHECK ("inserted_on" <= CURRENT_DATE + 1);
ALTER TABLE "leads" ADD CONSTRAINT "leads_won_progress_check" CHECK (("status" = 'won') = ("progress" = 100));
ALTER TABLE "leads" ADD CONSTRAINT "leads_lost_reason_check" CHECK ("status" <> 'lost' OR "loss_reason" IS NOT NULL);
ALTER TABLE "leads" ADD CONSTRAINT "leads_revenue_check" CHECK ("expected_revenue" IS NULL OR "expected_revenue" >= 0);
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_progress_check" CHECK ("to_progress" IN (10, 20, 40, 60, 80, 90, 100));
