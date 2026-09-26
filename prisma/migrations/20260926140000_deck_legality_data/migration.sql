-- CreateTable
CREATE TABLE "Format" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "activeCardPoolId" TEXT,
    "activeSnapshotId" TEXT,
    "activeRestrictionId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Restriction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "dateStart" DATETIME,
    "pointLimit" INTEGER,
    "bannedSubtypes" TEXT NOT NULL DEFAULT ',',
    "updatedAt" DATETIME NOT NULL,
    "formatId" TEXT NOT NULL,
    CONSTRAINT "Restriction_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "Format" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RestrictionVerdict" (
    "cardId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "value" INTEGER,
    "restrictionId" TEXT NOT NULL,

    PRIMARY KEY ("restrictionId", "cardId", "verdict"),
    CONSTRAINT "RestrictionVerdict_restrictionId_fkey" FOREIGN KEY ("restrictionId") REFERENCES "Restriction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Card" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "strippedTitle" TEXT NOT NULL,
    "sideId" TEXT NOT NULL,
    "text" TEXT,
    "strippedText" TEXT,
    "displaySubtypes" TEXT,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "deckLimit" INTEGER NOT NULL,
    "cost" TEXT,
    "influenceCost" INTEGER,
    "legalFormats" TEXT NOT NULL DEFAULT ',',
    "minimumDeckSize" INTEGER,
    "influenceLimit" INTEGER,
    "agendaPoints" INTEGER,
    "subtypes" TEXT NOT NULL DEFAULT ',',
    "updatedAt" DATETIME NOT NULL,
    "factionId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    CONSTRAINT "Card_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Card_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CardType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Card" ("cost", "deckLimit", "displaySubtypes", "factionId", "id", "influenceCost", "isUnique", "legalFormats", "sideId", "strippedText", "strippedTitle", "text", "title", "typeId", "updatedAt") SELECT "cost", "deckLimit", "displaySubtypes", "factionId", "id", "influenceCost", "isUnique", "legalFormats", "sideId", "strippedText", "strippedTitle", "text", "title", "typeId", "updatedAt" FROM "Card";
DROP TABLE "Card";
ALTER TABLE "new_Card" RENAME TO "Card";
CREATE INDEX "Card_strippedTitle_idx" ON "Card"("strippedTitle");
CREATE INDEX "Card_sideId_factionId_idx" ON "Card"("sideId", "factionId");
CREATE INDEX "Card_typeId_idx" ON "Card"("typeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Restriction_formatId_dateStart_idx" ON "Restriction"("formatId", "dateStart");

-- CreateIndex
CREATE INDEX "RestrictionVerdict_cardId_idx" ON "RestrictionVerdict"("cardId");

