-- CreateTable
CREATE TABLE "PreferredPrinting" (
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "printingId" TEXT NOT NULL,

    PRIMARY KEY ("userId", "cardId"),
    CONSTRAINT "PreferredPrinting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreferredPrinting_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreferredPrinting_printingId_fkey" FOREIGN KEY ("printingId") REFERENCES "Printing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PreferredPrinting_cardId_idx" ON "PreferredPrinting"("cardId");

-- CreateIndex
CREATE INDEX "PreferredPrinting_printingId_idx" ON "PreferredPrinting"("printingId");

