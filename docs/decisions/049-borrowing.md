# Borrowing Cards From a Shared Collection

Date: 2026-09-28

Status: accepted

## Context

Collections can be shared read-only (048). Friends lend each other cards, so a
deck should be able to fill from a collection shared with its owner, with the
lender agreeing first and the lent copies unavailable to the lender's own decks
while they're out.

## Decision

Two tables: `BorrowRequest { borrowerId, lenderId, status }` and
`DeckLoan { requestId, deckId, cardId, quantity, status, noticeId }`. A deck
card's own copies (`fromCollection`) plus its loans never exceed its quantity;
the identity counts as one copy. The logic is in
`app/utils/borrowing.server.ts`. Deck writes don't manage loans: after changing
the deck they call `reconcileDeckLoans` (`app/utils/deck-loans.server.ts`) once,
which gives back loans for cards that left and trims cards that play fewer
copies.

- **One pending request per borrower and lender.** "Fill from <name>'s
  collection" and the per-card "Borrowed from <name>" stepper add to it, across
  decks. `BorrowRequest.pendingKey` (unique, set only while pending) makes the
  database enforce it, so concurrent borrowing can't open a second one. Filling
  from a lender only asks for copies with no source yet (not from the owner's
  collection, not borrowed), and filling from the owner's collection never takes
  borrowed copies back.
- **Pending copies are held.** `getAvailability` counts pending and approved
  loans against the lender, so they can't go into the lender's decks or to
  another borrower.
- **The lender approves or rejects a request as a whole.** Afterwards they can
  take back (revoke) one card's lent copies, from one borrower or everyone, on
  their collection's card tiles or the Borrowing page.
- **Rejected and revoked copies stay in the deck, marked,** until the borrower
  accepts (they become plain copies) or asks again (they join the open request,
  as far as the lender has copies free). One `noticeId` groups each rejection or
  revocation.
- **The borrower gives copies back freely:** stepping down, "Give back <name>'s
  cards", fewer copies in the deck, removing the card, deleting the deck, or
  withdrawing the request. None of these needs approval. An emptied pending
  request is cancelled.
- **Removing a share ends its loans.** If the lender stops sharing, lent copies
  are revoked and pending requests rejected; the borrower can only accept those.
  If the borrower leaves, their copies simply go back (nothing to answer) and
  the lender is emailed about what came back.
- **Notifications:** the header's bell lists requests to answer and notices,
  answerable in place; `/borrowing` has the details. Each step also emails the
  other user (`borrowing-email.server.tsx`) without the action waiting for it; a
  failed email is logged, not thrown.

The lender sees the cards asked for, never the borrower's deck names: decks are
still private.

## Consequences

- A request can't be partly approved; the lender rejects and the borrower asks
  again for less, or the lender revokes cards after approving.
- A lender whose collection shrinks below what they've lent isn't blocked; the
  loans stand until revoked.
- Approving doesn't re-check availability, since pending copies were already
  held.
