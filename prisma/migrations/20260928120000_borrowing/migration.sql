-- CreateTable
CREATE TABLE "BorrowRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "respondedAt" DATETIME,
    "borrowerId" TEXT NOT NULL,
    "lenderId" TEXT NOT NULL,
    CONSTRAINT "BorrowRequest_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BorrowRequest_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeckLoan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "noticeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "requestId" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    CONSTRAINT "DeckLoan_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BorrowRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeckLoan_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeckLoan_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BorrowRequest_borrowerId_lenderId_status_idx" ON "BorrowRequest"("borrowerId", "lenderId", "status");

-- CreateIndex
CREATE INDEX "BorrowRequest_lenderId_status_idx" ON "BorrowRequest"("lenderId", "status");

-- CreateIndex
CREATE INDEX "DeckLoan_deckId_cardId_idx" ON "DeckLoan"("deckId", "cardId");

-- CreateIndex
CREATE INDEX "DeckLoan_cardId_status_idx" ON "DeckLoan"("cardId", "status");

-- CreateIndex
CREATE INDEX "DeckLoan_noticeId_idx" ON "DeckLoan"("noticeId");

-- CreateIndex
CREATE UNIQUE INDEX "DeckLoan_requestId_deckId_cardId_status_key" ON "DeckLoan"("requestId", "deckId", "cardId", "status");

