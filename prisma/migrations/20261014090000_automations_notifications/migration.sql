-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "automation_key" TEXT;

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "rule_code" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "evaluated" INTEGER NOT NULL DEFAULT 0,
    "tasks_created" INTEGER NOT NULL DEFAULT 0,
    "notifications_created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_by_user_id" UUID,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL DEFAULT 1,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_code_key" ON "automation_rules"("code");

-- CreateIndex
CREATE INDEX "automation_runs_rule_code_started_at_idx" ON "automation_runs"("rule_code", "started_at");

-- CreateIndex
CREATE INDEX "automation_runs_started_at_idx" ON "automation_runs"("started_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_automation_key_key" ON "tasks"("automation_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contraintes d'intégrité
ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_code_check" CHECK ("code" IN ('inactivity', 'no_next_action', 'close_date_overdue', 'meeting_soon', 'task_overdue'));

ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_trigger_check" CHECK ("trigger" IN ('manual', 'schedule')),
  ADD CONSTRAINT "automation_runs_status_check" CHECK ("status" IN ('running', 'success', 'error'));

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_item_count_check" CHECK ("item_count" >= 1);

-- Règles connues, avec leurs paramètres par défaut (CDC 6.2). L'administrateur peut ensuite les activer, les
-- désactiver et ajuster leurs seuils. « ON CONFLICT » rend la migration rejouable sans écraser un réglage existant.
INSERT INTO "automation_rules" ("id", "code", "enabled", "params", "updated_at") VALUES
  (gen_random_uuid(), 'inactivity', true, '{"largeAccountMinEmployees":250,"largeDays":15,"standardDays":30,"frequencyDays":7,"dueInDays":2}', now()),
  (gen_random_uuid(), 'no_next_action', true, '{"frequencyDays":1}', now()),
  (gen_random_uuid(), 'close_date_overdue', true, '{"frequencyDays":7,"escalationDays":7}', now()),
  (gen_random_uuid(), 'meeting_soon', true, '{"hoursBefore":24}', now()),
  (gen_random_uuid(), 'task_overdue', true, '{"frequencyDays":1,"escalationDays":3}', now())
ON CONFLICT ("code") DO NOTHING;
