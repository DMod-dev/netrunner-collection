import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { prisma } from './db.server.ts'
import { MAX_DECK_NAME_LENGTH } from './deck.ts'
import {
	copyDeck,
	copyName,
	createDeck,
	deleteDeck,
	getDeckForBuilder,
	getIdentities,
	listDecks,
	removeIllegalCards,
	requireDeck,
	searchPublicDecks,
	setDeckCardQuantity,
	setDeckIdentity,
	updateDeck,
} from './deck.server.ts'

async function insertUser() {
	return prisma.user.create({ data: createUser(), select: { id: true } })
}

async function insertDeck(userId: string, identityCardId = 'precision_design') {
	const deck = await createDeck(userId, {
		identityCardId,
		formatId: 'standard',
	})
	if (!deck) throw new Error('no deck')
	return deck
}

test('createDeck takes its side and name from the identity', async () => {
	await insertCards()
	const user = await insertUser()

	const named = await createDeck(user.id, {
		identityCardId: 'the_catalyst',
		formatId: 'startup',
		name: '  Catalyst aggro  ',
	})
	expect(
		await prisma.deck.findUniqueOrThrow({ where: { id: named!.id } }),
	).toMatchObject({
		name: 'Catalyst aggro',
		sideId: 'runner',
		formatId: 'startup',
		// not checked until the user asks
		requireLegality: false,
		identityCardId: 'the_catalyst',
	})

	const unnamed = await insertDeck(user.id)
	expect(
		await prisma.deck.findUniqueOrThrow({ where: { id: unnamed.id } }),
	).toMatchObject({ name: 'Haas-Bioroid: Precision Design', sideId: 'corp' })

	// only identities can lead a deck
	expect(
		await createDeck(user.id, {
			identityCardId: 'hedge_fund',
			formatId: 'standard',
		}),
	).toBeNull()
	expect(
		await createDeck(user.id, { identityCardId: 'nope', formatId: 'standard' }),
	).toBeNull()
})

test('setDeckCardQuantity upserts, clamps and deletes at 0', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	const row = () =>
		prisma.deckCard.findUnique({
			where: { deckId_cardId: { deckId: deck.id, cardId: 'hedge_fund' } },
		})

	expect(await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 3)).toEqual({
		quantity: 3,
	})
	expect(await row()).toMatchObject({ quantity: 3, fromCollection: 0 })

	// over the deck limit saves (the rules report it); past the cap clamps
	expect(await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 50)).toEqual(
		{ quantity: 9 },
	)

	expect(await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 0)).toEqual({
		quantity: 0,
	})
	expect(await row()).toBeNull()
	// removing a card that isn't there is fine
	expect(await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 0)).toEqual({
		quantity: 0,
	})
})

test('lowering a quantity clamps the copies reserved from the collection', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	await prisma.deckCard.create({
		data: {
			deckId: deck.id,
			cardId: 'hedge_fund',
			quantity: 3,
			fromCollection: 3,
		},
	})
	const fromCollection = async () =>
		(
			await prisma.deckCard.findUniqueOrThrow({
				where: { deckId_cardId: { deckId: deck.id, cardId: 'hedge_fund' } },
			})
		).fromCollection

	await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 2)
	expect(await fromCollection()).toBe(2)
	// raising it again doesn't reserve more
	await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 3)
	expect(await fromCollection()).toBe(2)
})

test('setDeckCardQuantity refuses identities, the other side and unknown cards', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)

	expect(
		await setDeckCardQuantity(user.id, deck.id, 'corroder', 1),
	).toMatchObject({
		status: 400,
		error: expect.stringContaining('runner card'),
	})
	expect(
		await setDeckCardQuantity(user.id, deck.id, 'precision_design', 1),
	).toMatchObject({ status: 400, error: expect.stringContaining('identity') })
	expect(await setDeckCardQuantity(user.id, deck.id, 'nope', 1)).toMatchObject({
		status: 404,
	})
	expect(await prisma.deckCard.count()).toBe(0)
})

test('changing cards bumps the deck to the top of the list', async () => {
	await insertCards()
	const user = await insertUser()
	const first = await insertDeck(user.id)
	const second = await insertDeck(user.id)
	await prisma.deck.update({
		where: { id: first.id },
		data: { updatedAt: new Date('2026-01-01') },
	})
	await prisma.deck.update({
		where: { id: second.id },
		data: { updatedAt: new Date('2026-01-02') },
	})

	expect((await listDecks(user.id)).map((d) => d.id)).toEqual([
		second.id,
		first.id,
	])
	await setDeckCardQuantity(user.id, first.id, 'hedge_fund', 1)
	expect((await listDecks(user.id)).map((d) => d.id)).toEqual([
		first.id,
		second.id,
	])
})

test('setDeckIdentity switches sides only while the deck is empty', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	const saved = () =>
		prisma.deck.findUniqueOrThrow({
			where: { id: deck.id },
			select: { identityCardId: true, sideId: true },
		})

	expect(await setDeckIdentity(user.id, deck.id, 'hedge_fund')).toMatchObject({
		status: 404,
	})

	await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 3)
	expect(await setDeckIdentity(user.id, deck.id, 'the_catalyst')).toMatchObject(
		{ status: 400, error: expect.stringContaining('empty the deck') },
	)
	expect(await saved()).toEqual({
		identityCardId: 'precision_design',
		sideId: 'corp',
	})

	await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 0)
	expect(await setDeckIdentity(user.id, deck.id, 'the_catalyst')).toEqual({
		ok: true,
	})
	expect(await saved()).toEqual({
		identityCardId: 'the_catalyst',
		sideId: 'runner',
	})
})

test('only the owner can change a deck, or see it while it’s private', async () => {
	await insertCards()
	const owner = await insertUser()
	const other = await insertUser()
	const deck = await insertDeck(owner.id)
	await setDeckCardQuantity(owner.id, deck.id, 'hedge_fund', 2)

	// public by default: anyone, signed in or not, can look
	expect(
		await requireDeck(other.id, deck.id, { select: { name: true } }),
	).toMatchObject({ name: 'Haas-Bioroid: Precision Design' })
	expect(await requireDeck(null, deck.id, { select: { id: true } })).toEqual(
		expect.objectContaining({ id: deck.id }),
	)

	expect(await updateDeck(owner.id, deck.id, { isPublic: false })).toBe(true)
	const notFound = expect.objectContaining({ status: 404 })
	await expect(
		requireDeck(other.id, deck.id, { select: { id: true } }),
	).rejects.toEqual(notFound)
	await expect(
		requireDeck(null, deck.id, { select: { id: true } }),
	).rejects.toEqual(notFound)
	await expect(getDeckForBuilder(other.id, deck.id)).rejects.toEqual(notFound)
	await expect(
		requireDeck(owner.id, 'missing', { select: { id: true } }),
	).rejects.toEqual(notFound)
	expect(await updateDeck(other.id, deck.id, { isPublic: true })).toBe(false)

	expect(
		await setDeckCardQuantity(other.id, deck.id, 'hedge_fund', 3),
	).toMatchObject({ status: 404 })
	expect(
		await setDeckIdentity(other.id, deck.id, 'precision_design'),
	).toMatchObject({ status: 404 })
	expect(await updateDeck(other.id, deck.id, { name: 'Mine now' })).toBe(false)
	expect(await deleteDeck(other.id, deck.id)).toBe(false)
	expect(await listDecks(other.id)).toEqual([])

	expect(
		await requireDeck(owner.id, deck.id, { select: { name: true } }),
	).toMatchObject({ name: 'Haas-Bioroid: Precision Design' })
	expect(await prisma.deckCard.count()).toBe(1)
})

test('updateDeck and deleteDeck', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 2)

	expect(
		await updateDeck(user.id, deck.id, {
			name: 'Glacier',
			notes: 'Tech: more ice',
			formatId: 'eternal',
			requireLegality: false,
		}),
	).toBe(true)
	expect(
		await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } }),
	).toMatchObject({
		name: 'Glacier',
		notes: 'Tech: more ice',
		formatId: 'eternal',
		requireLegality: false,
	})

	expect(await deleteDeck(user.id, deck.id)).toBe(true)
	expect(await prisma.deck.count()).toBe(0)
	// its cards go with it
	expect(await prisma.deckCard.count()).toBe(0)
})

test('listDecks sums up each deck', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 3)

	const [summary] = await listDecks(user.id)
	expect(summary).toMatchObject({
		id: deck.id,
		name: 'Haas-Bioroid: Precision Design',
		formatId: 'standard',
		identity: {
			id: 'precision_design',
			factionName: 'Haas-Bioroid',
			imageUrl: 'https://img/precision_design.jpg',
		},
		cardCount: 3,
		minDeckSize: 45,
		// too small, and no agendas
		isLegal: false,
		filledFromCollection: false,
	})
	expect(summary!.errorCount).toBeGreaterThan(0)

	await prisma.deckCard.updateMany({ data: { fromCollection: 1 } })
	expect((await listDecks(user.id))[0]).toMatchObject({
		filledFromCollection: true,
	})
})

test('getDeckForBuilder returns the rules-ready deck', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 3)

	const builder = await getDeckForBuilder(user.id, deck.id)
	expect(builder).toMatchObject({
		id: deck.id,
		sideId: 'corp',
		formatId: 'standard',
		requireLegality: false,
		identity: {
			id: 'precision_design',
			minimumDeckSize: 45,
			legalFormats: ['standard'],
			factionName: 'Haas-Bioroid',
		},
		cards: [
			{
				quantity: 3,
				fromCollection: 0,
				card: {
					id: 'hedge_fund',
					typeName: 'Operation',
					subtypes: [],
					imageUrl: 'https://img/hedge_fund.jpg',
				},
			},
		],
		// no Standard format synced in this database
		rules: null,
	})
})

test('getIdentities lists one side’s identities', async () => {
	await insertCards()
	expect(await getIdentities('runner')).toEqual([
		expect.objectContaining({
			id: 'the_catalyst',
			factionName: 'Anarch',
			imageUrl: 'https://img/the_catalyst.jpg',
			legalFormats: ['standard'],
		}),
	])
})

test('removeIllegalCards takes out what the format doesn’t allow', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	await setDeckCardQuantity(user.id, deck.id, 'hedge_fund', 3)
	await prisma.deckCard.updateMany({ data: { fromCollection: 2 } })

	// every card here is Standard-legal
	expect(await removeIllegalCards(user.id, deck.id)).toEqual({
		removed: 0,
		formatId: 'standard',
	})
	expect(await prisma.deckCard.count()).toBe(1)

	// none of them are in Startup's pool; the identity stays
	await updateDeck(user.id, deck.id, { formatId: 'startup' })
	const other = await insertUser()
	expect(await removeIllegalCards(other.id, deck.id)).toBeNull()
	expect(await removeIllegalCards(user.id, deck.id)).toEqual({
		removed: 3,
		formatId: 'startup',
	})
	expect(await prisma.deckCard.count()).toBe(0)
	expect(
		await prisma.deck.findUniqueOrThrow({
			where: { id: deck.id },
			select: { identityCardId: true },
		}),
	).toEqual({ identityCardId: 'precision_design' })
})

test('getDeckForBuilder tells only the owner what’s from their collection', async () => {
	await insertCards()
	const owner = await insertUser()
	const other = await insertUser()
	const deck = await insertDeck(owner.id)
	await setDeckCardQuantity(owner.id, deck.id, 'hedge_fund', 3)
	await prisma.deckCard.updateMany({ data: { fromCollection: 2 } })
	await prisma.deck.update({
		where: { id: deck.id },
		data: { identityFromCollection: 1 },
	})

	const own = await getDeckForBuilder(owner.id, deck.id)
	expect(own).toMatchObject({
		isOwner: true,
		isPublic: true,
		identityFromCollection: 1,
		cards: [{ quantity: 3, fromCollection: 2 }],
	})
	expect(own.owner.username).toEqual(expect.any(String))

	for (const viewer of [other.id, null]) {
		expect(await getDeckForBuilder(viewer, deck.id)).toMatchObject({
			isOwner: false,
			identityFromCollection: 0,
			cards: [{ quantity: 3, fromCollection: 0 }],
		})
	}
})

test('searchPublicDecks finds public decks by name, identity, card or owner', async () => {
	await insertCards()
	const alice = await prisma.user.create({
		data: { ...createUser(), username: 'alice_runs', name: 'Alice' },
		select: { id: true },
	})
	const bob = await prisma.user.create({
		data: { ...createUser(), username: 'bob_brews', name: 'Bob' },
		select: { id: true },
	})
	const glacier = await createDeck(alice.id, {
		identityCardId: 'precision_design',
		formatId: 'standard',
		name: 'Glacier',
	})
	await setDeckCardQuantity(alice.id, glacier!.id, 'hedge_fund', 3)
	const breaker = await createDeck(bob.id, {
		identityCardId: 'the_catalyst',
		formatId: 'startup',
		name: 'Breaker suite',
	})
	await setDeckCardQuantity(bob.id, breaker!.id, 'corroder', 2)
	const secret = await createDeck(bob.id, {
		identityCardId: 'the_catalyst',
		formatId: 'standard',
		name: 'Secret tech',
	})
	await updateDeck(bob.id, secret!.id, { isPublic: false })

	const names = async (search: Parameters<typeof searchPublicDecks>[0]) =>
		(await searchPublicDecks(search)).decks.map((d) => d.name).sort()

	// private decks never show up
	expect(await names({})).toEqual(['Breaker suite', 'Glacier'])
	expect(await names({ q: 'secret' })).toEqual([])
	// deck name, identity, card and owner; every word has to match something
	expect(await names({ q: 'glac' })).toEqual(['Glacier'])
	expect(await names({ q: 'catalyst' })).toEqual(['Breaker suite'])
	expect(await names({ q: 'corroder' })).toEqual(['Breaker suite'])
	expect(await names({ q: 'alice' })).toEqual(['Glacier'])
	expect(await names({ q: 'bob corroder' })).toEqual(['Breaker suite'])
	expect(await names({ q: 'bob hedge' })).toEqual([])
	// filters
	expect(await names({ side: 'corp' })).toEqual(['Glacier'])
	expect(await names({ factionId: 'anarch' })).toEqual(['Breaker suite'])
	expect(await names({ formatId: 'startup' })).toEqual(['Breaker suite'])
	expect(await names({ author: 'alice_runs' })).toEqual(['Glacier'])
	expect(await names({ author: 'alice' })).toEqual([])

	const { decks, total, page, pageCount } = await searchPublicDecks({
		q: 'glacier',
		page: 5,
	})
	expect({ total, page, pageCount }).toEqual({
		total: 1,
		page: 1,
		pageCount: 1,
	})
	expect(decks[0]).toMatchObject({
		name: 'Glacier',
		owner: { username: 'alice_runs', name: 'Alice' },
		cardCount: 3,
		identity: { title: 'Haas-Bioroid: Precision Design' },
	})
	// what's in the owner's collection isn't part of it
	expect(decks[0]).not.toHaveProperty('copiesFromCollection')
})

test('copyDeck copies a public deck or the user’s own, not a private one', async () => {
	await insertCards()
	const owner = await insertUser()
	const other = await insertUser()
	const deck = await insertDeck(owner.id)
	await setDeckCardQuantity(owner.id, deck.id, 'hedge_fund', 3)
	await updateDeck(owner.id, deck.id, {
		notes: 'Score out',
		formatId: 'startup',
		requireLegality: true,
	})
	await prisma.deckCard.updateMany({ data: { fromCollection: 3 } })

	const copy = await copyDeck(other.id, deck.id)
	expect(copy?.name).toBe('Haas-Bioroid: Precision Design (copy)')
	expect(
		await prisma.deck.findUniqueOrThrow({
			where: { id: copy!.id },
			select: {
				userId: true,
				identityCardId: true,
				formatId: true,
				requireLegality: true,
				notes: true,
				isPublic: true,
				identityFromCollection: true,
				cards: {
					select: { cardId: true, quantity: true, fromCollection: true },
				},
			},
		}),
	).toEqual({
		userId: other.id,
		identityCardId: 'precision_design',
		formatId: 'startup',
		requireLegality: true,
		notes: 'Score out',
		isPublic: true,
		identityFromCollection: 0,
		// nothing is reserved from the new owner's collection yet
		cards: [{ cardId: 'hedge_fund', quantity: 3, fromCollection: 0 }],
	})

	await updateDeck(owner.id, deck.id, { isPublic: false })
	expect(await copyDeck(other.id, deck.id)).toBeNull()
	expect(await copyDeck(owner.id, deck.id)).not.toBeNull()
	expect(await copyDeck(owner.id, 'missing')).toBeNull()
})

test('copyName keeps the name within the limit', () => {
	expect(copyName('Glacier')).toBe('Glacier (copy)')
	const long = copyName('x'.repeat(MAX_DECK_NAME_LENGTH))
	expect(long).toHaveLength(MAX_DECK_NAME_LENGTH)
	expect(long.endsWith(' (copy)')).toBe(true)
})
