-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "author_user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "contact_id" UUID,
    "opportunity_id" UUID,
    "outcome" TEXT,
    "next_action" TEXT,
    "next_action_date" DATE,
    "origin" TEXT NOT NULL DEFAULT 'user',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assignee_user_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "account_id" UUID,
    "contact_id" UUID,
    "opportunity_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "origin" TEXT NOT NULL DEFAULT 'user',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_account_id_occurred_at_idx" ON "activities"("account_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_opportunity_id_occurred_at_idx" ON "activities"("opportunity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_contact_id_idx" ON "activities"("contact_id");

-- CreateIndex
CREATE INDEX "activities_author_user_id_occurred_at_idx" ON "activities"("author_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "tasks_assignee_user_id_status_due_date_idx" ON "tasks"("assignee_user_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "tasks_account_id_idx" ON "tasks"("account_id");

-- CreateIndex
CREATE INDEX "tasks_opportunity_id_idx" ON "tasks"("opportunity_id");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Contraintes d'intégrité (CDC 6) : la base refuse ce que les règles métier interdisent.
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_type_check" CHECK ("type" IN ('call_in', 'call_out', 'email', 'meeting', 'video', 'note', 'proposal_sent', 'contract_step')),
  ADD CONSTRAINT "activities_origin_check" CHECK ("origin" IN ('user', 'sync', 'automation')),
  ADD CONSTRAINT "activities_next_action_check" CHECK ("next_action_date" IS NULL OR "next_action" IS NOT NULL);

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_status_check" CHECK ("status" IN ('open', 'done', 'cancelled')),
  ADD CONSTRAINT "tasks_priority_check" CHECK ("priority" IN ('low', 'normal', 'high')),
  ADD CONSTRAINT "tasks_origin_check" CHECK ("origin" IN ('user', 'automation')),
  -- Une tâche est terminée si et seulement si elle porte sa date de réalisation.
  ADD CONSTRAINT "tasks_completed_check" CHECK (("status" = 'done') = ("completed_at" IS NOT NULL));
