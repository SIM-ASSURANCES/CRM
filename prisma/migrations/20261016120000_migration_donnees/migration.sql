-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "profile" JSONB,
ADD COLUMN     "validated_at" TIMESTAMPTZ(3),
ADD COLUMN     "validated_by_user_id" UUID,
ADD COLUMN     "value_map" JSONB;

-- AlterTable
ALTER TABLE "import_rows" ADD COLUMN     "warnings" JSONB;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_validated_by_user_id_fkey" FOREIGN KEY ("validated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Le lot d'import accepte les prospects (migration des fichiers de reporting prospect) et un statut « validé »
-- (rapprochement accepté par l'administrateur : la source est alors effacée).
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_entity_check";
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_entity_check" CHECK ("entity" IN ('accounts', 'contacts', 'leads'));
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_status_check";
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_status_check" CHECK ("status" IN ('uploaded', 'analyzed', 'importing', 'imported', 'validated', 'cancelled'));
-- Un lot validé porte sa date ET son validateur (jamais l'un sans l'autre).
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_validation_check" CHECK (("validated_at" IS NULL) = ("validated_by_user_id" IS NULL) AND (("status" = 'validated') = ("validated_at" IS NOT NULL)));
