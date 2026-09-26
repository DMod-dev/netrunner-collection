# Collection Sharing: Per-User Grants First

Date: 2026-09-26

Status: accepted

## Context

Users want to show their collection to friends (to plan trades, or to check what
cards are available before borrowing some for a deck). There are several ways to
do that: grant access to specific users, share an unguessable link, or make a
collection public. They differ in how much the owner controls who sees the
collection, and in how much there is to build.

The app already has role-based permissions (`Permission` / `Role`, e.g.
`update:user:own`), but those apply to everyone in a role. Sharing is about one
user's rows being visible to another specific user.

## Decision

Start with per-user grants only: a `CollectionShare { ownerId, viewerId }` table
where each row lets the viewer browse the owner's collection read-only. It is a
row-level relation, so it is not modelled through `Permission` / `Role`.

Every collection loader and action decides whose collection it is showing, and
whether the caller may edit it, through one helper:
`requireCollectionAccess(request, ownerUsername?)` in
`app/utils/collection-access.server.ts` (plus `getCollectionAccess`, which
returns null instead of throwing, for deciding whether to show a link).

- Viewing always requires a logged-in user.
- Your own collection is always editable.
- Someone else's collection is viewable, read-only, only with a grant row.
  Admins get no implicit access.
- An unknown username and a missing grant are both a 404 with the same message,
  so the response doesn't reveal whether a user exists or who has access.

The collection write action (`app/routes/resources/collection.tsx`) only ever
writes the caller's own rows, so a read-only view can't change someone else's
collection even if a form or fetcher fires by mistake.

## Consequences

- Owners choose exactly who sees their collection, and deleting either user
  removes the grant (cascade).
- Link sharing (`CollectionShareLink { token, expiresAt }`) and a public or
  unlisted visibility setting can be added later as extra branches in the helper
  without touching routes.
- No accept/decline flow or notifications: a grant takes effect immediately.
