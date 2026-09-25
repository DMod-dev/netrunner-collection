-- @param {String} $1:usernameLike
-- @param {String} $2:nameLike
-- The better-sqlite3 adapter only binds anonymous `?` placeholders
-- positionally, so a reused named parameter (`:like`) no longer works.
SELECT 
  "User".id,
  "User".username,
  "User".name,
  "UserImage".id AS imageId,
  "UserImage".objectKey AS imageObjectKey
FROM "User"
LEFT JOIN "UserImage" ON "User".id = "UserImage".userId
WHERE "User".username LIKE ?
OR "User".name LIKE ?
ORDER BY "User".username ASC
LIMIT 50
