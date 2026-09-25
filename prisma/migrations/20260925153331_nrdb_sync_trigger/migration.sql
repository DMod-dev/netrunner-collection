-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NrdbSync" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'cli',
    "summary" TEXT,
    "error" TEXT
);
INSERT INTO "new_NrdbSync" ("error", "finishedAt", "id", "startedAt", "status", "summary") SELECT "error", "finishedAt", "id", "startedAt", "status", "summary" FROM "NrdbSync";
DROP TABLE "NrdbSync";
ALTER TABLE "new_NrdbSync" RENAME TO "NrdbSync";
CREATE INDEX "NrdbSync_startedAt_idx" ON "NrdbSync"("startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
