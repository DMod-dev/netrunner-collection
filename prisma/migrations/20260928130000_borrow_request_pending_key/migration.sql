-- AlterTable
ALTER TABLE "BorrowRequest" ADD COLUMN "pendingKey" TEXT;

-- Backfill: each pair's oldest pending request is its open one
UPDATE "BorrowRequest"
SET "pendingKey" = "borrowerId" || ':' || "lenderId"
WHERE "status" = 'pending'
  AND "id" = (
    SELECT "b"."id" FROM "BorrowRequest" AS "b"
    WHERE "b"."borrowerId" = "BorrowRequest"."borrowerId"
      AND "b"."lenderId" = "BorrowRequest"."lenderId"
      AND "b"."status" = 'pending'
    ORDER BY "b"."createdAt", "b"."id"
    LIMIT 1
  );

-- CreateIndex
CREATE UNIQUE INDEX "BorrowRequest_pendingKey_key" ON "BorrowRequest"("pendingKey");
