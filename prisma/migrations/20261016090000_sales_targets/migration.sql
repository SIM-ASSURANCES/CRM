-- CreateTable
CREATE TABLE "sales_targets" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_targets_period_start_idx" ON "sales_targets"("period_start");

-- CreateIndex
CREATE UNIQUE INDEX "sales_targets_owner_user_id_period_start_key" ON "sales_targets"("owner_user_id", "period_start");

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contraintes que Prisma ne sait pas exprimer : un objectif est positif ou nul, et porte sur un mois entier (1er jour).
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_month_start_check" CHECK ("period_start" = date_trunc('month', "period_start")::date);
