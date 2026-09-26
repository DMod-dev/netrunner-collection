import { type Prisma } from '@prisma/client'
import { getOwnedCounts } from './collection.server.ts'
import { prisma } from './db.server.ts'
import {
	type Availability,
	isReservationStale,
	NO_COPIES,
	type Reservation,
} from './deck-fill.ts'

// "Fill with collection" records, per deck card, how many copies come from
// the owner's collection (DeckCard.fromCollection, and
// Deck.identityFromCollection for the identity). Copies are counted per card:
// any printing or custom version will do. Whichever deck is filled first
// holds the copies; what other decks hold is summed from their rows.

type Db = Prisma.TransactionClient

/**
 * For each card, how many copies the user owns and how many their other
 * decks (all but `excludeDeckId`) hold. Another user's decks never count.
 */
export async function getAvailability(
	userId: string,
	cardIds: string[],
	excludeDeckId: string | null,
	db: Db = prisma,
): Promise<Map<string, Availability>> {
	const ids = [...new Set(cardIds)]
	const result = new Map<string, Availability>()
	if (ids.length === 0) return result

	const otherDecks = {
		userId,
		...(excludeDeckId ? { id: { not: excludeDeckId } } : {}),
	}
	const [owned, cardRows, identityRows] = await Promise.all([
		getOwnedCounts(userId, { cardIds: ids, db }),
		db.deckCard.findMany({
			where: {
				cardId: { in: ids },
				fromCollection: { gt: 0 },
				deck: otherDecks,
			},
			select: {
				cardId: true,
				fromCollection: true,
				deck: { select: { id: true, name: true } },
			},
		}),
		db.deck.findMany({
			where: {
				...otherDecks,
				identityCardId: { in: ids },
				identityFromCollection: { gt: 0 },
			},
			select: {
				id: true,
				name: true,
				identityCardId: true,
				identityFromCollection: true,
			},
		}),
	])

	const reservedBy = new Map<string, Reservation[]>()
	const reserve = (cardId: string, reservation: Reservation) => {
		const list = reservedBy.get(cardId)
		if (list) list.push(reservation)
		else reservedBy.set(cardId, [reservation])
	}
	for (const row of cardRows) {
		reserve(row.cardId, {
			deckId: row.deck.id,
			name: row.deck.name,
			quantity: row.fromCollection,
		})
	}
	for (const deck of identityRows) {
		if (!deck.identityCardId) continue
		reserve(deck.identityCardId, {
			deckId: deck.id,
			name: deck.name,
			quantity: deck.identityFromCollection,
		})
	}

	for (const cardId of ids) {
		const reservations = (reservedBy.get(cardId) ?? []).sort((a, b) =>
			a.name.localeCompare(b.name),
		)
		const count = owned.byCard.get(cardId) ?? 0
		const elsewhere = reservations.reduce((sum, r) => sum + r.quantity, 0)
		result.set(cardId, {
			owned: count,
			reservedElsewhere: elsewhere,
			reservedBy: reservations,
			available: Math.max(0, count - elsewhere),
		})
	}
	return result
}

export type FillReport = {
	/** copies now reserved from the collection, the identity included */
	taken: number
	/** copies the deck plays, the identity included */
	total: number
}

/**
 * Reserve as many of the deck's copies from the collection as are free:
 * `min(quantity, available)` per card. This deck's own reservations aren't
 * counted against it, so filling again refreshes them after the collection
 * or another deck changed. Returns null if the user doesn't own the deck.
 */
export async function fillDeck(
	userId: string,
	deckId: string,
): Promise<FillReport | null> {
	return prisma.$transaction(async (tx) => {
		const deck = await tx.deck.findFirst({
			where: { id: deckId, userId },
			select: {
				identityCardId: true,
				identityFromCollection: true,
				cards: {
					select: { cardId: true, quantity: true, fromCollection: true },
				},
			},
		})
		if (!deck) return null
		const availability = await getAvailability(
			userId,
			[
				...deck.cards.map((c) => c.cardId),
				...(deck.identityCardId ? [deck.identityCardId] : []),
			],
			deckId,
			tx,
		)
		const available = (cardId: string) =>
			(availability.get(cardId) ?? NO_COPIES).available

		let taken = 0
		let total = 0
		for (const row of deck.cards) {
			const next = Math.min(row.quantity, available(row.cardId))
			taken += next
			total += row.quantity
			if (next === row.fromCollection) continue
			await tx.deckCard.update({
				where: { deckId_cardId: { deckId, cardId: row.cardId } },
				data: { fromCollection: next },
			})
		}
		if (deck.identityCardId) {
			const next = Math.min(1, available(deck.identityCardId))
			taken += next
			total += 1
			if (next !== deck.identityFromCollection) {
				await tx.deck.update({
					where: { id: deckId },
					data: { identityFromCollection: next },
				})
			}
		}
		return { taken, total }
	})
}

/**
 * Set how many of one card's copies come from the collection, by hand. It's
 * capped at the copies the deck plays and the copies other decks leave free.
 * The identity counts as the one copy it plays. Returns null if the user
 * doesn't own the deck, or an error if the card isn't in it.
 */
export async function setFromCollection(
	userId: string,
	deckId: string,
	cardId: string,
	fromCollection: number,
): Promise<{ error: string } | { fromCollection: number } | null> {
	return prisma.$transaction(async (tx) => {
		const deck = await tx.deck.findFirst({
			where: { id: deckId, userId },
			select: {
				identityCardId: true,
				cards: { where: { cardId }, select: { quantity: true } },
			},
		})
		if (!deck) return null
		const isIdentity = deck.identityCardId === cardId
		const quantity = isIdentity ? 1 : (deck.cards[0]?.quantity ?? 0)
		if (quantity === 0) return { error: 'That card isn’t in this deck' }
		const availability =
			(await getAvailability(userId, [cardId], deckId, tx)).get(cardId) ??
			NO_COPIES
		const next = Math.max(
			0,
			Math.min(Math.trunc(fromCollection), quantity, availability.available),
		)
		if (isIdentity) {
			await tx.deck.update({
				where: { id: deckId },
				data: { identityFromCollection: next },
			})
		} else {
			await tx.deckCard.update({
				where: { deckId_cardId: { deckId, cardId } },
				data: { fromCollection: next },
			})
		}
		return { fromCollection: next }
	})
}

/**
 * Give every copy the deck holds back to the collection. Returns false if the
 * user doesn't own the deck.
 */
export async function unfillDeck(userId: string, deckId: string) {
	return prisma.$transaction(async (tx) => {
		const { count } = await tx.deck.updateMany({
			where: { id: deckId, userId },
			data: { identityFromCollection: 0 },
		})
		if (count === 0) return false
		await tx.deckCard.updateMany({
			where: { deckId, fromCollection: { gt: 0 } },
			data: { fromCollection: 0 },
		})
		return true
	})
}

/**
 * The deck's collection state for the builder: whether it's filled, whether
 * the collection changed under it, and the availability of its cards plus
 * `extraCardIds` (the card browser's page).
 */
export async function getDeckCollection(
	userId: string,
	deck: {
		id: string
		identity: { id: string } | null
		identityFromCollection: number
		cards: Array<{ card: { id: string }; fromCollection: number }>
	},
	extraCardIds: string[] = [],
) {
	const rows = [
		...deck.cards.map((c) => ({
			cardId: c.card.id,
			fromCollection: c.fromCollection,
		})),
		...(deck.identity
			? [
					{
						cardId: deck.identity.id,
						fromCollection: deck.identityFromCollection,
					},
				]
			: []),
	]
	// every deck needs its cards' availability: each card's "from
	// collection" stepper goes up to what's free
	const map = await getAvailability(
		userId,
		[...rows.map((r) => r.cardId), ...extraCardIds],
		deck.id,
	)
	const of = (cardId: string) => map.get(cardId) ?? NO_COPIES
	// an unfilled deck's badges count every copy owned, as the browser has
	const filled = rows.some((r) => r.fromCollection > 0)
	return {
		filled,
		stale:
			filled &&
			rows.some((r) => isReservationStale(r.fromCollection, of(r.cardId))),
		availability: Object.fromEntries(map) as Record<string, Availability>,
	}
}

/**
 * How many copies of each card the user's decks hold from their collection,
 * for the collection pages. Cards no deck holds are left out.
 */
export async function getCopiesInUse(userId: string, cardIds: string[]) {
	const inUse = new Map<string, number>()
	if (cardIds.length === 0) return inUse
	const [cards, identities] = await Promise.all([
		prisma.deckCard.groupBy({
			by: ['cardId'],
			where: {
				cardId: { in: cardIds },
				fromCollection: { gt: 0 },
				deck: { userId },
			},
			_sum: { fromCollection: true },
		}),
		prisma.deck.groupBy({
			by: ['identityCardId'],
			where: {
				userId,
				identityCardId: { in: cardIds },
				identityFromCollection: { gt: 0 },
			},
			_sum: { identityFromCollection: true },
		}),
	])
	const add = (cardId: string | null, n: number | null) => {
		if (!cardId || !n) return
		inUse.set(cardId, (inUse.get(cardId) ?? 0) + n)
	}
	for (const row of cards) add(row.cardId, row._sum.fromCollection)
	for (const row of identities) {
		add(row.identityCardId, row._sum.identityFromCollection)
	}
	return inUse
}
