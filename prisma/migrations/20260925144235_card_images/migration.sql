/*
  Warnings:

  - You are about to drop the column `sideId` on the `CardType` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CardType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CardType" ("id", "name", "updatedAt") SELECT "id", "name", "updatedAt" FROM "CardType";
DROP TABLE "CardType";
ALTER TABLE "new_CardType" RENAME TO "CardType";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
