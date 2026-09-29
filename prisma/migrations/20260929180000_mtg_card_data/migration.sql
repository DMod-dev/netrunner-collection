-- CreateTable
CREATE TABLE "MtgSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setType" TEXT NOT NULL,
    "releasedAt" DATETIME,
    "cardCount" INTEGER NOT NULL DEFAULT 0,
    "parentSetCode" TEXT,
    "iconSvgUri" TEXT,
    "digital" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MtgCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "strippedName" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "manaCost" TEXT,
    "manaValue" REAL NOT NULL DEFAULT 0,
    "typeLine" TEXT NOT NULL DEFAULT '',
    "oracleText" TEXT,
    "colors" TEXT NOT NULL DEFAULT ',',
    "colorIdentity" TEXT NOT NULL DEFAULT ',',
    "types" TEXT NOT NULL DEFAULT ',',
    "subtypes" TEXT NOT NULL DEFAULT ',',
    "keywords" TEXT NOT NULL DEFAULT ',',
    "producedMana" TEXT NOT NULL DEFAULT ',',
    "power" TEXT,
    "toughness" TEXT,
    "loyalty" TEXT,
    "legalFormats" TEXT NOT NULL DEFAULT ',',
    "restrictedFormats" TEXT NOT NULL DEFAULT ',',
    "bannedFormats" TEXT NOT NULL DEFAULT ',',
    "gameChanger" BOOLEAN NOT NULL DEFAULT false,
    "edhrecRank" INTEGER,
    "reserved" BOOLEAN NOT NULL DEFAULT false,
    "faces" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MtgPrinting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectorNumber" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "finishes" TEXT NOT NULL DEFAULT ',nonfoil,',
    "lang" TEXT NOT NULL DEFAULT 'en',
    "frame" TEXT,
    "frameEffects" TEXT NOT NULL DEFAULT ',',
    "promoTypes" TEXT NOT NULL DEFAULT ',',
    "borderColor" TEXT,
    "fullArt" BOOLEAN NOT NULL DEFAULT false,
    "promo" BOOLEAN NOT NULL DEFAULT false,
    "booster" BOOLEAN NOT NULL DEFAULT false,
    "reprint" BOOLEAN NOT NULL DEFAULT false,
    "artist" TEXT,
    "illustrationId" TEXT,
    "flavorText" TEXT,
    "releasedAt" DATETIME,
    "imageStatus" TEXT NOT NULL DEFAULT 'missing',
    "multiFaceImages" BOOLEAN NOT NULL DEFAULT false,
    "priceUsd" REAL,
    "priceUsdFoil" REAL,
    "priceUsdEtched" REAL,
    "priceEur" REAL,
    "priceEurFoil" REAL,
    "tcgplayerId" INTEGER,
    "cardmarketId" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    "cardId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    CONSTRAINT "MtgPrinting_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "MtgCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MtgPrinting_setId_fkey" FOREIGN KEY ("setId") REFERENCES "MtgSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MtgSync" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'cli',
    "bulkUpdatedAt" DATETIME,
    "summary" TEXT,
    "error" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "MtgSet_code_key" ON "MtgSet"("code");

-- CreateIndex
CREATE INDEX "MtgSet_releasedAt_idx" ON "MtgSet"("releasedAt");

-- CreateIndex
CREATE INDEX "MtgCard_strippedName_idx" ON "MtgCard"("strippedName");

-- CreateIndex
CREATE INDEX "MtgCard_manaValue_idx" ON "MtgCard"("manaValue");

-- CreateIndex
CREATE INDEX "MtgPrinting_setId_collectorNumber_idx" ON "MtgPrinting"("setId", "collectorNumber");

-- CreateIndex
CREATE INDEX "MtgPrinting_cardId_idx" ON "MtgPrinting"("cardId");

-- CreateIndex
CREATE INDEX "MtgPrinting_illustrationId_idx" ON "MtgPrinting"("illustrationId");

-- CreateIndex
CREATE INDEX "MtgSync_startedAt_idx" ON "MtgSync"("startedAt");
