-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sideId" TEXT NOT NULL,
    "formatId" TEXT NOT NULL DEFAULT 'standard',
    "requireLegality" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "nrdbUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "identityCardId" TEXT,
    CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deck_identityCardId_fkey" FOREIGN KEY ("identityCardId") REFERENCES "Card" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeckCard" (
    "quantity" INTEGER NOT NULL,
    "fromCollection" INTEGER NOT NULL DEFAULT 0,
    "deckId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,

    PRIMARY KEY ("deckId", "cardId"),
    CONSTRAINT "DeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeckCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Deck_userId_updatedAt_idx" ON "Deck"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Deck_identityCardId_idx" ON "Deck"("identityCardId");

-- CreateIndex
CREATE INDEX "DeckCard_cardId_idx" ON "DeckCard"("cardId");
