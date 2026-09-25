/*
  Warnings:

  - You are about to drop the `Note` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `NoteImage` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Note";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "NoteImage";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Faction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sideId" TEXT NOT NULL,
    "isMini" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CardType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sideId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CardCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "dateRelease" DATETIME,
    "releasedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CardSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "setTypeId" TEXT NOT NULL,
    "dateRelease" DATETIME,
    "releasedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "cycleId" TEXT NOT NULL,
    CONSTRAINT "CardSet_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "CardCycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Card" (
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
    "updatedAt" DATETIME NOT NULL,
    "factionId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    CONSTRAINT "Card_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Card_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CardType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Printing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "illustrator" TEXT,
    "flavor" TEXT,
    "dateRelease" DATETIME,
    "imageUrl" TEXT,
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    "cardId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    CONSTRAINT "Printing_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Printing_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CardSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NrdbSync" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "CollectionEntry" (
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "printingId" TEXT NOT NULL,

    PRIMARY KEY ("userId", "printingId"),
    CONSTRAINT "CollectionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionEntry_printingId_fkey" FOREIGN KEY ("printingId") REFERENCES "Printing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "printingId" TEXT NOT NULL,
    CONSTRAINT "Variant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Variant_printingId_fkey" FOREIGN KEY ("printingId") REFERENCES "Printing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CardSet_cycleId_idx" ON "CardSet"("cycleId");

-- CreateIndex
CREATE INDEX "Card_strippedTitle_idx" ON "Card"("strippedTitle");

-- CreateIndex
CREATE INDEX "Card_sideId_factionId_idx" ON "Card"("sideId", "factionId");

-- CreateIndex
CREATE INDEX "Card_typeId_idx" ON "Card"("typeId");

-- CreateIndex
CREATE INDEX "Printing_cardId_idx" ON "Printing"("cardId");

-- CreateIndex
CREATE INDEX "Printing_setId_position_idx" ON "Printing"("setId", "position");

-- CreateIndex
CREATE INDEX "CollectionEntry_printingId_idx" ON "CollectionEntry"("printingId");

-- CreateIndex
CREATE INDEX "Variant_printingId_idx" ON "Variant"("printingId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_userId_printingId_label_key" ON "Variant"("userId", "printingId", "label");

-- The demo "note" entity is gone; drop its permissions too.
DELETE FROM "Permission" WHERE "entity" = 'note';
