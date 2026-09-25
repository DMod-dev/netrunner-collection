/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `Printing` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Printing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "illustrator" TEXT,
    "flavor" TEXT,
    "dateRelease" DATETIME,
    "imageSmall" TEXT,
    "imageLarge" TEXT,
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    "cardId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    CONSTRAINT "Printing_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Printing_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CardSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Printing" ("cardId", "dateRelease", "flavor", "id", "illustrator", "isLatest", "position", "quantity", "setId", "updatedAt") SELECT "cardId", "dateRelease", "flavor", "id", "illustrator", "isLatest", "position", "quantity", "setId", "updatedAt" FROM "Printing";
DROP TABLE "Printing";
ALTER TABLE "new_Printing" RENAME TO "Printing";
CREATE INDEX "Printing_cardId_idx" ON "Printing"("cardId");
CREATE INDEX "Printing_setId_position_idx" ON "Printing"("setId", "position");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
