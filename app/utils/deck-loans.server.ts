import { type Prisma } from '@prisma/client'

// Keeping a deck's borrowed copies (DeckLoan rows, see borrowing.server.ts)
// within the copies it plays. Each deck card's copies from the owner's
// collection plus its loans never exceed its quantity; the deck writes call
// these whenever a card's quantity drops or it leaves the deck.

type Db = Prisma.TransactionClient

/**
 * Copies of each card the deck borrows, in any state (rejected and revoked
 * copies hold their place until the borrower answers them).
 */
export async function getLoanedCounts(db: Db, deckId: string) {
	const rows = await db.deckLoan.groupBy({
		by: ['cardId'],
		where: { deckId },
		_sum: { quantity: true },
	})
	return new Map(rows.map((row) => [row.cardId, row._sum.quantity ?? 0]))
}

/**
 * Which copies go first when a deck plays fewer: plain copies (not
 * recorded), then copies marked not lent, then ones still asked for, then
 * lent ones (newest first), and the owner's own copies last.
 */
const DROP_ORDER: Record<string, number> = {
	rejected: 0,
	revoked: 0,
	pending: 1,
	approved: 2,
}

/**
 * Give back copies of one card until the collection's and borrowed copies
 * fit in `quantity`. Returns the copies from the collection left, for the
 * caller to save (DeckCard.fromCollection or Deck.identityFromCollection).
 */
export async function fitLoansToQuantity(
	db: Db,
	{
		deckId,
		cardId,
		quantity,
		fromCollection,
	}: {
		deckId: string
		cardId: string
		quantity: number
		fromCollection: number
	},
) {
	const loans = await db.deckLoan.findMany({
		where: { deckId, cardId },
		select: { id: true, quantity: true, status: true, createdAt: true },
	})
	let excess =
		fromCollection + loans.reduce((n, l) => n + l.quantity, 0) - quantity
	if (excess <= 0) return fromCollection
	loans.sort(
		(a, b) =>
			(DROP_ORDER[a.status] ?? 0) - (DROP_ORDER[b.status] ?? 0) ||
			b.createdAt.getTime() - a.createdAt.getTime(),
	)
	for (const loan of loans) {
		if (excess <= 0) break
		const drop = Math.min(excess, loan.quantity)
		excess -= drop
		if (drop === loan.quantity) {
			await db.deckLoan.delete({ where: { id: loan.id } })
		} else {
			await db.deckLoan.update({
				where: { id: loan.id },
				data: { quantity: loan.quantity - drop },
			})
		}
	}
	await cancelEmptyRequests(db, deckId)
	return Math.max(0, fromCollection - excess)
}

/** Give back every borrowed copy of these cards (they left the deck). */
export async function dropLoans(db: Db, deckId: string, cardIds: string[]) {
	if (cardIds.length === 0) return
	const { count } = await db.deckLoan.deleteMany({
		where: { deckId, cardId: { in: cardIds } },
	})
	if (count > 0) await cancelEmptyRequests(db, deckId)
}

/**
 * A pending request with nothing left in it (the borrower gave every copy
 * back) is cancelled, so the lender doesn't see an empty one. Scoped to the
 * owner of `deckId`, or to `borrowerId`.
 */
export async function cancelEmptyRequests(
	db: Db,
	deckId: string | null,
	borrowerId?: string,
) {
	const owner =
		borrowerId ??
		(deckId
			? (
					await db.deck.findUnique({
						where: { id: deckId },
						select: { userId: true },
					})
				)?.userId
			: undefined)
	if (!owner) return
	await db.borrowRequest.updateMany({
		where: {
			borrowerId: owner,
			status: 'pending',
			loans: { none: { status: 'pending' } },
		},
		data: { status: 'cancelled', respondedAt: new Date() },
	})
}
