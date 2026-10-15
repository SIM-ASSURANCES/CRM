-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "headers" JSONB NOT NULL,
    "mapping" JSONB,
    "defaults" JSONB,
    "report" JSONB,
    "total_rows" INTEGER NOT NULL,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "rejected_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analyzed_at" TIMESTAMPTZ(3),
    "imported_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "parsed" JSONB,
    "errors" JSONB,
    "duplicate_of" TEXT,
    "created_entity_id" UUID,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_created_at_idx" ON "import_batches"("created_at");

-- CreateIndex
CREATE INDEX "import_rows_batch_id_status_idx" ON "import_rows"("batch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batch_id_row_number_key" ON "import_rows"("batch_id", "row_number");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contraintes d'intégrité de l'import
ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_entity_check" CHECK ("entity" IN ('accounts', 'contacts')),
  ADD CONSTRAINT "import_batches_status_check" CHECK ("status" IN ('uploaded', 'analyzed', 'importing', 'imported', 'cancelled')),
  ADD CONSTRAINT "import_batches_counts_check" CHECK ("total_rows" >= 0 AND "valid_rows" >= 0 AND "rejected_rows" >= 0 AND "duplicate_rows" >= 0 AND "imported_rows" >= 0);

ALTER TABLE "import_rows"
  ADD CONSTRAINT "import_rows_status_check" CHECK ("status" IN ('pending', 'valid', 'rejected', 'duplicate', 'imported')),
  ADD CONSTRAINT "import_rows_row_number_check" CHECK ("row_number" >= 2);
