import { type Prisma } from '@prisma/client'

// Keeping a deck's borrowed copies (DeckLoan rows, see borrowing.server.ts)
// in step with the deck. Each deck card's copies from the owner's
// collection plus its loans never exceed its quantity (the identity counts
// as one copy), and a card that leaves the deck gives its loans back.
//
// Deck writes don't manage loans themselves: they change the deck, then call
// `reconcileDeckLoans` once, which works out what has to go from the deck
// as it now is.

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
 * Bring a deck's loans in line with its cards and identity, after any write
 * that changed them: loans for cards no longer in the deck go back, and a
 * card with more copies from the collection and borrowed than it plays gives
 * back the extra in DROP_ORDER. An emptied pending request is cancelled.
 */
export async function reconcileDeckLoans(db: Db, deckId: string) {
	const deck = await db.deck.findUnique({
		where: { id: deckId },
		select: {
			userId: true,
			identityCardId: true,
			identityFromCollection: true,
			cards: { select: { cardId: true, quantity: true, fromCollection: true } },
			loans: {
				select: {
					id: true,
					cardId: true,
					quantity: true,
					status: true,
					createdAt: true,
				},
			},
		},
	})
	if (!deck) return
	const rows = new Map(
		deck.cards.map((c) => [
			c.cardId,
			{ quantity: c.quantity, fromCollection: c.fromCollection },
		]),
	)
	const identity = deck.identityCardId
	if (identity) {
		rows.set(identity, {
			quantity: 1,
			fromCollection: deck.identityFromCollection,
		})
	}

	const loansByCard = new Map<string, typeof deck.loans>()
	const orphans: string[] = []
	for (const loan of deck.loans) {
		if (!rows.has(loan.cardId)) {
			orphans.push(loan.id)
			continue
		}
		const list = loansByCard.get(loan.cardId)
		if (list) list.push(loan)
		else loansByCard.set(loan.cardId, [loan])
	}
	let changed = orphans.length > 0
	if (orphans.length) {
		await db.deckLoan.deleteMany({ where: { id: { in: orphans } } })
	}

	for (const [cardId, row] of rows) {
		const loans = loansByCard.get(cardId) ?? []
		let excess =
			row.fromCollection +
			loans.reduce((n, l) => n + l.quantity, 0) -
			row.quantity
		if (excess <= 0) continue
		changed = true
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
		// what's still over comes out of the owner's own copies
		if (excess > 0) {
			const fromCollection = Math.max(0, row.fromCollection - excess)
			if (cardId === identity) {
				await db.deck.update({
					where: { id: deckId },
					data: { identityFromCollection: fromCollection },
				})
			} else {
				await db.deckCard.update({
					where: { deckId_cardId: { deckId, cardId } },
					data: { fromCollection },
				})
			}
		}
	}
	if (changed) await cancelEmptyRequests(db, deck.userId)
}

/**
 * A pending request with nothing left in it (the borrower gave every copy
 * back) is cancelled, so the lender doesn't see an empty one.
 */
export async function cancelEmptyRequests(db: Db, borrowerId: string) {
	await db.borrowRequest.updateMany({
		where: {
			borrowerId,
			status: 'pending',
			loans: { none: { status: 'pending' } },
		},
		data: { status: 'cancelled', respondedAt: new Date(), pendingKey: null },
	})
}
