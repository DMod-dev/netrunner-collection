import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { prisma } from './db.server.ts'
import {
	createDeck,
	deleteDeck,
	getDeckForBuilder,
	getIdentities,
	listDecks,
	requireDeck,
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
		requireLegality: true,
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

test('only the owner can see or change a deck', async () => {
	await insertCards()
	const owner = await insertUser()
	const other = await insertUser()
	const deck = await insertDeck(owner.id)
	await setDeckCardQuantity(owner.id, deck.id, 'hedge_fund', 2)

	const notFound = expect.objectContaining({ status: 404 })
	await expect(
		requireDeck(other.id, deck.id, { select: { id: true } }),
	).rejects.toEqual(notFound)
	await expect(getDeckForBuilder(other.id, deck.id)).rejects.toEqual(notFound)
	await expect(
		requireDeck(owner.id, 'missing', { select: { id: true } }),
	).rejects.toEqual(notFound)

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
		requireLegality: true,
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
