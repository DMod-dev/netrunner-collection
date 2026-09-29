# Magic: The Gathering as a Second, Siloed Domain

Date: 2026-09-29

Status: accepted

## Context

The app tracks Netrunner collections and decks. We want the same for Magic: The
Gathering (collection, sets, decks, sharing, borrowing, import/export), plus
MTG-only features: scanning cards with the camera, and deck theorycrafting
(roadmap: issue #74). The two games share almost nothing at the card level:
Netrunner cards have sides, factions and influence; MTG cards have colours, mana
costs, many faces and layouts, a hundred thousand printings, finishes and
prices.

Card data comes from Scryfall. Its API asks for at most 10 requests a second and
points bulk consumers at its bulk data files instead. `default_cards` (every
card in English, or its printed language when only printed in one) is ~80 MB of
gzipped JSON Lines, ~600 MB inflated, ~118k printings, refreshed about every 12
hours. Production runs on one Fly machine with 512 MB of RAM.

## Decision

- **Parallel tables and routes, not a shared card "spine".** MTG gets its own
  `MtgSet`, `MtgCard` (one row per Oracle id), `MtgPrinting` (one row per
  Scryfall id, paper only) and `MtgSync`, and later its own collection and deck
  tables, under `/mtg/*` routes. Netrunner's tables and URLs don't change. A
  spine with a `game` column would have loosened Netrunner-only required columns
  and added a game filter to every existing query. Only the fill, borrow and
  loan engines are game-agnostic enough to share, behind an adapter (#62);
  `CollectionShare` will cover both games.
- **Scryfall's ids are ours.** Every row is keyed by Scryfall's id, so a sync
  upserts. Image URLs follow from the printing id (`app/utils/mtg-images.ts`),
  so nothing is stored per image size; the CSP's `img-src` allows
  `cards.scryfall.io` and `svgs.scryfall.io`.
- **The sync streams.** `app/utils/scryfall.server.ts` gunzips the bulk file
  with Node's zlib stream and parses one line at a time, so memory stays flat
  (the web `DecompressionStream` buffered 100+ MB ahead of the parser). Rows are
  written in batches of 500 with one prepared statement per row on a
  `node:sqlite` connection of its own (`app/utils/mtg-card-db.server.ts`),
  skipping rows whose values haven't changed, so a quiet day's sync writes few
  pages for LiteFS to replicate. Measured locally with V8's heap capped at 128
  MB: a full import of 109k printings takes ~12 s and peaks at ~270 MB RSS; a
  re-import of the same file writes nothing and takes ~5 s.
- **Skip unchanged files.** A run whose file has the same `updated_at` as the
  last import records a skipped success without downloading. Admins' "Sync now"
  and `npm run sync:scryfall -- --force` import anyway.
- **Deletions are careful.** Printings no longer in the file are deleted, except
  ones user data refers to (their foreign keys make the delete fail and the row
  is kept and counted); cards left without printings follow. If more than 10% of
  printings (and over 1,000) vanish at once, nothing is deleted: that's a bad
  file, not Scryfall deleting cards. MTG collection and deck tables must
  reference printings and cards with `onDelete: Restrict` so this keeps working.
- **Digital-only printings are skipped** (Arena, MTGO): this is a paper
  collection app. Tokens, emblems and art cards are kept; `MtgSet.setType` lets
  pages hide them.
- **One run/log layer for both syncs.** `app/utils/sync-runner.server.ts`
  (single run per source, stale "running" rows cleared, `syncIfDue`) and
  `app/utils/card-sync-scheduler.server.ts` (hourly checks on the LiteFS
  primary, never under mocks or in tests) serve NetrunnerDB and Scryfall.
  `MTG_AUTO_SYNC=false` turns the Scryfall sync off, like `NRDB_AUTO_SYNC`.
- **Caches key on the file.** `cachedUntilNextMtgSync` keys on the imported
  file's `updated_at`, so skipped runs don't throw away derived lookups.

## Consequences

- Features that exist for both games (collection pages, deck builder, import and
  export) are written twice. Shared UI pieces can still be extracted when the
  second copy shows what's common.
- The database grows by ~80 MB for MTG card data.
- Non-English printings of multi-language cards aren't mirrored: that's
  Scryfall's `all_cards` file (~400 MB gzipped). Revisit if language variants
  become more than a collection-entry attribute.
- Rulings and art tags aren't mirrored yet.
