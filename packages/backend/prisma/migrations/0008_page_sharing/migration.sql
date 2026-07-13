ALTER TABLE "pages" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pages" ADD COLUMN "public_token" TEXT;
CREATE UNIQUE INDEX "pages_public_token_key" ON "pages"("public_token");
