import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { prisma } from './db.server.ts'
import {
	fillDeck,
	getAvailability,
	getCopiesInUse,
	getDeckCollection,
	unfillDeck,
} from './deck-fill.server.ts'
import { fillStatus } from './deck-fill.ts'
import {
	createDeck,
	deleteDeck,
	getDeckForBuilder,
	listDecks,
	setDeckCardQuantity,
	setDeckIdentity,
} from './deck.server.ts'

// insertCards gives each card one printing: 30002 is The Catalyst, 30003
// is Corroder.
const CATALYST_PRINTING = '30002'
const CORRODER_PRINTING = '30003'

async function insertUser() {
	return prisma.user.create({ data: createUser(), select: { id: true } })
}

async function own(userId: string, printingId: string, quantity: number) {
	await prisma.collectionEntry.upsert({
		where: { userId_printingId: { userId, printingId } },
		create: { userId, printingId, quantity },
		update: { quantity },
	})
}

/** A Catalyst deck with `corroders` Corroders. */
async function insertDeck(userId: string, name: string, corroders: number) {
	const deck = await createDeck(userId, {
		identityCardId: 'the_catalyst',
		formatId: 'standard',
		name,
	})
	if (!deck) throw new Error('no deck')
	if (corroders) {
		await setDeckCardQuantity(userId, deck.id, 'corroder', corroders)
	}
	return deck
}

async function corroderRow(deckId: string) {
	const row = await prisma.deckCard.findUniqueOrThrow({
		where: { deckId_cardId: { deckId, cardId: 'corroder' } },
		select: { quantity: true, fromCollection: true },
	})
	return `${row.fromCollection}/${row.quantity}`
}

/** What the builder would show for Corroder in the deck. */
async function corroderStatus(userId: string, deckId: string) {
	const [row, availability] = await Promise.all([
		prisma.deckCard.findUniqueOrThrow({
			where: { deckId_cardId: { deckId, cardId: 'corroder' } },
		}),
		getAvailability(userId, ['corroder'], deckId),
	])
	const a = availability.get('corroder')!
	return {
		...fillStatus({ ...row, owned: a.owned, available: a.available }),
		reservedBy: a.reservedBy.map((r) => `${r.quantity} ${r.name}`),
	}
}

test('fill takes what the collection has; the first deck filled keeps it', async () => {
	await insertCards()
	const user = await insertUser()
	await own(user.id, CORRODER_PRINTING, 3)
	const a = await insertDeck(user.id, 'A', 3)
	const b = await insertDeck(user.id, 'B', 3)

	// own 3, A plays 3: all of them (no identity owned, so 3 of 4)
	expect(await fillDeck(user.id, a.id)).toEqual({ taken: 3, total: 4 })
	expect(await corroderRow(a.id)).toBe('3/3')
	expect(await corroderStatus(user.id, a.id)).toMatchObject({ kind: 'ok' })

	// B gets none: A holds them
	expect(await fillDeck(user.id, b.id)).toEqual({ taken: 0, total: 4 })
	expect(await corroderRow(b.id)).toBe('0/3')
	expect(await corroderStatus(user.id, b.id)).toEqual({
		kind: 'inUseElsewhere',
		short: 3,
		need: 0,
		inUse: 3,
		unreserved: 0,
		reservedBy: ['3 A'],
	})

	// unfill A, then fill B: B gets them all
	await unfillDeck(user.id, a.id)
	expect(await corroderRow(a.id)).toBe('0/3')
	await fillDeck(user.id, b.id)
	expect(await corroderRow(b.id)).toBe('3/3')
})

test('owning too few: fill takes what there is and reports the rest', async () => {
	await insertCards()
	const user = await insertUser()
	await own(user.id, CORRODER_PRINTING, 2)
	const b = await insertDeck(user.id, 'B', 3)

	await fillDeck(user.id, b.id)
	expect(await corroderRow(b.id)).toBe('2/3')
	expect(await corroderStatus(user.id, b.id)).toMatchObject({
		kind: 'missing',
		need: 1,
		inUse: 0,
	})

	// with A filled first, B is short 1 it doesn't own and 2 that A holds
	await unfillDeck(user.id, b.id)
	const a = await insertDeck(user.id, 'A', 3)
	await fillDeck(user.id, a.id)
	await fillDeck(user.id, b.id)
	expect(await corroderRow(a.id)).toBe('2/3')
	expect(await corroderRow(b.id)).toBe('0/3')
	expect(await corroderStatus(user.id, b.id)).toMatchObject({
		kind: 'missingAndInUse',
		need: 1,
		inUse: 2,
		reservedBy: ['2 A'],
	})
})

test('changing a deck gives its copies back', async () => {
	await insertCards()
	const user = await insertUser()
	await own(user.id, CORRODER_PRINTING, 3)
	const a = await insertDeck(user.id, 'A', 3)
	const b = await insertDeck(user.id, 'B', 3)
	await fillDeck(user.id, a.id)
	const availableToB = async () =>
		(await getAvailability(user.id, ['corroder'], b.id)).get('corroder')!
			.available

	// fewer copies: the reservation follows
	await setDeckCardQuantity(user.id, a.id, 'corroder', 2)
	expect(await corroderRow(a.id)).toBe('2/2')
	expect(await availableToB()).toBe(1)

	// taking the card out frees them all
	await setDeckCardQuantity(user.id, a.id, 'corroder', 0)
	expect(await availableToB()).toBe(3)

	// and so does deleting the deck
	await setDeckCardQuantity(user.id, a.id, 'corroder', 3)
	await fillDeck(user.id, a.id)
	expect(await availableToB()).toBe(0)
	await deleteDeck(user.id, a.id)
	expect(await availableToB()).toBe(3)
})

test('copies added after filling are "unreserved" until the next fill', async () => {
	await insertCards()
	const user = await insertUser()
	await own(user.id, CORRODER_PRINTING, 3)
	const a = await insertDeck(user.id, 'A', 2)
	await fillDeck(user.id, a.id)
	await setDeckCardQuantity(user.id, a.id, 'corroder', 3)

	expect(await corroderRow(a.id)).toBe('2/3')
	expect(await corroderStatus(user.id, a.id)).toMatchObject({
		kind: 'unreserved',
		unreserved: 1,
	})
	await fillDeck(user.id, a.id)
	expect(await corroderRow(a.id)).toBe('3/3')
})

test('a collection that shrank after filling makes the deck stale', async () => {
	await insertCards()
	const user = await insertUser()
	await own(user.id, CORRODER_PRINTING, 3)
	const a = await insertDeck(user.id, 'A', 3)
	await fillDeck(user.id, a.id)
	const collection = async () =>
		getDeckCollection(user.id, await getDeckForBuilder(user.id, a.id))

	expect(await collection()).toMatchObject({ filled: true, stale: false })
	await own(user.id, CORRODER_PRINTING, 1)
	expect(await collection()).toMatchObject({ filled: true, stale: true })

	// filling again brings it back in line
	await fillDeck(user.id, a.id)
	expect(await corroderRow(a.id)).toBe('1/3')
	expect(await corroderStatus(user.id, a.id)).toMatchObject({
		kind: 'missing',
		need: 2,
	})
	expect(await collection()).toMatchObject({ stale: false })
})

test('the identity is reserved like any other card', async () => {
	await insertCards()
	const user = await insertUser()
	await own(user.id, CATALYST_PRINTING, 1)
	const a = await insertDeck(user.id, 'A', 0)
	const b = await insertDeck(user.id, 'B', 0)

	expect(await fillDeck(user.id, a.id)).toEqual({ taken: 1, total: 1 })
	expect(await fillDeck(user.id, b.id)).toEqual({ taken: 0, total: 1 })
	const availability = await getAvailability(user.id, ['the_catalyst'], b.id)
	expect(availability.get('the_catalyst')).toMatchObject({
		owned: 1,
		available: 0,
		reservedBy: [{ deckId: a.id, name: 'A', quantity: 1 }],
	})
	expect(await getCopiesInUse(user.id, ['the_catalyst'])).toEqual(
		new Map([['the_catalyst', 1]]),
	)

	// the deck list shows it
	const summaries = await listDecks(user.id)
	expect(summaries.find((d) => d.id === a.id)).toMatchObject({
		filledFromCollection: true,
		copiesFromCollection: 1,
		shortFromCollection: false,
	})

	// another identity isn't reserved until the deck is filled again
	await setDeckIdentity(user.id, a.id, 'the_catalyst')
	expect(
		await prisma.deck.findUniqueOrThrow({
			where: { id: a.id },
			select: { identityFromCollection: true },
		}),
	).toEqual({ identityFromCollection: 1 })
	await setDeckIdentity(user.id, a.id, 'precision_design')
	expect(
		await prisma.deck.findUniqueOrThrow({
			where: { id: a.id },
			select: { identityFromCollection: true },
		}),
	).toEqual({ identityFromCollection: 0 })
})

test('every printing and custom version counts; other users’ decks don’t', async () => {
	await insertCards()
	const user = await insertUser()
	const other = await insertUser()
	await prisma.printing.create({
		data: {
			id: 'corroder-reprint',
			cardId: 'corroder',
			position: 99,
			quantity: 3,
			setId: 'sg',
		},
	})
	await own(user.id, CORRODER_PRINTING, 1)
	await own(user.id, 'corroder-reprint', 1)
	await prisma.variant.create({
		data: {
			userId: user.id,
			printingId: CORRODER_PRINTING,
			label: 'Alt art',
			quantity: 1,
		},
	})
	// another user's filled deck of their own Corroders
	await own(other.id, CORRODER_PRINTING, 3)
	const theirs = await insertDeck(other.id, 'Theirs', 3)
	await fillDeck(other.id, theirs.id)

	const mine = await insertDeck(user.id, 'Mine', 3)
	expect(
		(await getAvailability(user.id, ['corroder'], mine.id)).get('corroder'),
	).toEqual({ owned: 3, reservedElsewhere: 0, reservedBy: [], available: 3 })
	await fillDeck(user.id, mine.id)
	expect(await corroderRow(mine.id)).toBe('3/3')
	expect(await corroderRow(theirs.id)).toBe('3/3')

	// and nobody can fill or unfill someone else's deck
	expect(await fillDeck(other.id, mine.id)).toBeNull()
	expect(await unfillDeck(other.id, mine.id)).toBe(false)
	expect(await corroderRow(mine.id)).toBe('3/3')
})

test('filling two decks at once never reserves more than are owned', async () => {
	await insertCards()
	const user = await insertUser()
	await own(user.id, CORRODER_PRINTING, 3)
	const a = await insertDeck(user.id, 'A', 3)
	const b = await insertDeck(user.id, 'B', 3)

	await Promise.all([fillDeck(user.id, a.id), fillDeck(user.id, b.id)])
	const reserved = await prisma.deckCard.aggregate({
		where: { cardId: 'corroder' },
		_sum: { fromCollection: true },
	})
	expect(reserved._sum.fromCollection).toBe(3)
})

test('fillStatus', () => {
	const status = (
		quantity: number,
		fromCollection: number,
		owned: number,
		available: number,
	) => {
		const { kind, short, need, inUse, unreserved } = fillStatus({
			quantity,
			fromCollection,
			owned,
			available,
		})
		return [kind, short, need, inUse, unreserved]
	}
	// quantity, fromCollection, owned, available → kind, short, need, inUse, unreserved
	expect(status(3, 3, 3, 3)).toEqual(['ok', 0, 0, 0, 0])
	// stale, but every copy is still reserved
	expect(status(3, 3, 1, 1)).toEqual(['ok', 0, 0, 0, 0])
	expect(status(3, 0, 0, 0)).toEqual(['missing', 3, 3, 0, 0])
	expect(status(3, 2, 2, 2)).toEqual(['missing', 1, 1, 0, 0])
	expect(status(3, 0, 3, 0)).toEqual(['inUseElsewhere', 3, 0, 3, 0])
	expect(status(3, 1, 5, 1)).toEqual(['inUseElsewhere', 2, 0, 2, 0])
	expect(status(3, 0, 2, 0)).toEqual(['missingAndInUse', 3, 1, 2, 0])
	expect(status(3, 1, 2, 1)).toEqual(['missingAndInUse', 2, 1, 1, 0])
	expect(status(3, 2, 3, 3)).toEqual(['unreserved', 1, 0, 0, 1])
	// short some that are free, some that aren't owned
	expect(status(3, 0, 2, 2)).toEqual(['missing', 3, 1, 0, 2])
})
