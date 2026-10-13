-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "converted_account_id" UUID,
ADD COLUMN     "converted_at" TIMESTAMPTZ(3),
ADD COLUMN     "converted_contact_id" UUID,
ADD COLUMN     "converted_opportunity_id" UUID;

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "product_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "revenue_period" TEXT NOT NULL DEFAULT 'annual',
    "estimation_method" TEXT,
    "stage" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'open',
    "expected_close_date" DATE,
    "next_action" TEXT,
    "next_action_date" DATE,
    "competitor" TEXT,
    "current_solution" TEXT,
    "loss_reason" TEXT,
    "loss_comment" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_contacts" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "role_type" TEXT,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_events" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "type" TEXT NOT NULL,
    "from_stage" INTEGER,
    "to_stage" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "expected_close_date" DATE,

    CONSTRAINT "opportunity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunities_owner_user_id_status_stage_idx" ON "opportunities"("owner_user_id", "status", "stage");

-- CreateIndex
CREATE INDEX "opportunities_account_id_idx" ON "opportunities"("account_id");

-- CreateIndex
CREATE INDEX "opportunities_status_expected_close_date_idx" ON "opportunities"("status", "expected_close_date");

-- CreateIndex
CREATE INDEX "opportunity_contacts_contact_id_idx" ON "opportunity_contacts"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_contacts_opportunity_id_contact_id_key" ON "opportunity_contacts"("opportunity_id", "contact_id");

-- CreateIndex
CREATE INDEX "opportunity_events_opportunity_id_occurred_at_idx" ON "opportunity_events"("opportunity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "opportunity_events_occurred_at_type_idx" ON "opportunity_events"("occurred_at", "type");

-- CreateIndex
CREATE UNIQUE INDEX "leads_converted_opportunity_id_key" ON "leads"("converted_opportunity_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_account_id_fkey" FOREIGN KEY ("converted_account_id") REFERENCES "accounts_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_contact_id_fkey" FOREIGN KEY ("converted_contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_opportunity_id_fkey" FOREIGN KEY ("converted_opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_events" ADD CONSTRAINT "opportunity_events_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_events" ADD CONSTRAINT "opportunity_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Contraintes métier des opportunités (CDC 5.1, 5.2 et 14), appliquées au niveau de la base.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_check" CHECK ("stage" IN (10, 20, 40, 60, 80, 90, 100));
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_status_check" CHECK ("status" IN ('open', 'won', 'lost'));
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_won_stage_check" CHECK (("status" = 'won') = ("stage" = 100));
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lost_reason_check" CHECK ("status" <> 'lost' OR "loss_reason" IS NOT NULL);
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_period_check" CHECK ("revenue_period" IN ('one_time', 'monthly', 'annual'));
-- Une opportunité ouverte doit avoir une date de clôture prévisionnelle et une prochaine action datée.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_open_requirements_check" CHECK (
  "status" <> 'open' OR ("expected_close_date" IS NOT NULL AND "next_action" IS NOT NULL AND "next_action_date" IS NOT NULL)
);
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_closed_at_check" CHECK (("status" = 'open') = ("closed_at" IS NULL));

ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_role_check" CHECK ("role_type" IS NULL OR "role_type" IN ('decision_maker', 'validator', 'buyer', 'prescriber', 'user', 'other'));
-- Un seul contact principal par opportunité.
CREATE UNIQUE INDEX "opportunity_contacts_one_main" ON "opportunity_contacts" ("opportunity_id") WHERE "is_main";

ALTER TABLE "opportunity_events" ADD CONSTRAINT "opportunity_events_stage_check" CHECK ("to_stage" IN (10, 20, 40, 60, 80, 90, 100));
