-- AlterTable
ALTER TABLE "Deck" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Deck_isPublic_updatedAt_idx" ON "Deck"("isPublic", "updatedAt");
