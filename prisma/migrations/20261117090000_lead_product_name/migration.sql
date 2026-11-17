-- Produit proposé d'un prospect : saisie libre (texte) à la place de la liste du catalogue.
-- Les prospects existants reprennent le libellé de leur produit, pour que l'affichage et la modification restent cohérents.
ALTER TABLE "leads" ADD COLUMN "product_name" TEXT;

UPDATE "leads"
SET "product_name" = "products"."label"
FROM "products"
WHERE "leads"."product_id" = "products"."id";
