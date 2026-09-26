-- CreateTable
CREATE TABLE "CollectionShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    CONSTRAINT "CollectionShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionShare_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CollectionShare_viewerId_idx" ON "CollectionShare"("viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionShare_ownerId_viewerId_key" ON "CollectionShare"("ownerId", "viewerId");
