-- CreateTable
CREATE TABLE "accounts_crm" (
    "id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "legal_identifier" TEXT,
    "sector" TEXT,
    "employee_count" INTEGER,
    "revenue_amount" DECIMAL(18,2),
    "revenue_currency" TEXT NOT NULL DEFAULT 'XOF',
    "revenue_year" INTEGER,
    "revenue_source" TEXT,
    "collective_agreement" TEXT,
    "status" TEXT NOT NULL DEFAULT 'prospect',
    "source" TEXT,
    "phone" TEXT,
    "email_domain" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'CI',
    "parent_account_id" UUID,
    "owner_user_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "merged_into_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_crm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "job_title" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "preferred_channel" TEXT,
    "contact_restrictions" TEXT,
    "owner_user_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_contacts" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "relationship_title" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_roles" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "role_type" TEXT NOT NULL,
    "product_id" UUID,
    "influence" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_crm_owner_user_id_status_idx" ON "accounts_crm"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "accounts_crm_parent_account_id_idx" ON "accounts_crm"("parent_account_id");

-- CreateIndex
CREATE INDEX "accounts_crm_legal_name_idx" ON "accounts_crm"("legal_name");

-- CreateIndex
CREATE INDEX "accounts_crm_email_domain_idx" ON "accounts_crm"("email_domain");

-- CreateIndex
CREATE INDEX "contacts_owner_user_id_idx" ON "contacts"("owner_user_id");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_last_name_first_name_idx" ON "contacts"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "account_contacts_contact_id_idx" ON "account_contacts"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_contacts_account_id_contact_id_key" ON "account_contacts"("account_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_roles_account_id_contact_id_idx" ON "contact_roles"("account_id", "contact_id");

-- AddForeignKey
ALTER TABLE "accounts_crm" ADD CONSTRAINT "accounts_crm_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "accounts_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_crm" ADD CONSTRAINT "accounts_crm_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "accounts_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_crm" ADD CONSTRAINT "accounts_crm_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_roles" ADD CONSTRAINT "contact_roles_account_id_contact_id_fkey" FOREIGN KEY ("account_id", "contact_id") REFERENCES "account_contacts"("account_id", "contact_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_roles" ADD CONSTRAINT "contact_roles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contraintes métier (CDC 3.1 à 3.3 et A.5), appliquées au niveau de la base.
ALTER TABLE "accounts_crm" ADD CONSTRAINT "accounts_status_check" CHECK ("status" IN ('prospect', 'client', 'inactive', 'partner'));
ALTER TABLE "accounts_crm" ADD CONSTRAINT "accounts_parent_not_self_check" CHECK ("parent_account_id" IS NULL OR "parent_account_id" <> "id");
ALTER TABLE "accounts_crm" ADD CONSTRAINT "accounts_merge_archived_check" CHECK ("merged_into_id" IS NULL OR "archived_at" IS NOT NULL);
ALTER TABLE "accounts_crm" ADD CONSTRAINT "accounts_employee_count_check" CHECK ("employee_count" IS NULL OR "employee_count" >= 0);
ALTER TABLE "accounts_crm" ADD CONSTRAINT "accounts_revenue_check" CHECK ("revenue_amount" IS NULL OR "revenue_amount" >= 0);
ALTER TABLE "accounts_crm" ADD CONSTRAINT "accounts_country_check" CHECK ("country" ~ '^[A-Z]{2}$');

-- Unicité de l'identifiant légal par pays, parmi les comptes non archivés (CDC A.5).
CREATE UNIQUE INDEX "accounts_legal_identifier_unique" ON "accounts_crm" ("country", lower("legal_identifier"))
  WHERE "legal_identifier" IS NOT NULL AND "archived_at" IS NULL;

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_status_check" CHECK ("status" IN ('active', 'to_confirm', 'left'));
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_channel_check" CHECK ("preferred_channel" IS NULL OR "preferred_channel" IN ('email', 'phone', 'whatsapp', 'in_person'));

-- Un seul contact principal par compte.
CREATE UNIQUE INDEX "account_contacts_one_primary" ON "account_contacts" ("account_id") WHERE "is_primary";
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_dates_check" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date");

ALTER TABLE "contact_roles" ADD CONSTRAINT "contact_roles_type_check" CHECK ("role_type" IN ('decision_maker', 'validator', 'buyer', 'prescriber', 'user', 'other'));
ALTER TABLE "contact_roles" ADD CONSTRAINT "contact_roles_influence_check" CHECK ("influence" IS NULL OR "influence" IN ('high', 'medium', 'low'));
-- Pas deux fois le même rôle pour le même contact, le même compte et le même produit (produit nul compris).
CREATE UNIQUE INDEX "contact_roles_unique" ON "contact_roles" ("account_id", "contact_id", "role_type", COALESCE("product_id", '00000000-0000-0000-0000-000000000000'::uuid));
