import { afterEach, expect, test, vi } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { prisma } from './db.server.ts'
import { DeckImportError } from './deck-check.server.ts'
import { fillDeck } from './deck-fill.server.ts'
import {
	importDeck,
	readDeckInput,
	replaceDeckCards,
} from './deck-import.server.ts'
import { evaluateDeck } from './deck-rules.ts'
import { getDeckForBuilder, setDeckCardQuantity } from './deck.server.ts'

afterEach(() => {
	vi.restoreAllMocks()
})

const UUID = '58bc5c41-88d9-4cb9-b950-0f132f508f3d'
const options = { formatId: 'standard', requireLegality: true } as const

async function insertUser() {
	return prisma.user.create({ data: createUser(), select: { id: true } })
}

function savedDeck(deckId: string) {
	return prisma.deck.findUniqueOrThrow({
		where: { id: deckId },
		select: {
			name: true,
			sideId: true,
			formatId: true,
			requireLegality: true,
			nrdbUrl: true,
			identityCardId: true,
			identityFromCollection: true,
			cards: {
				orderBy: { cardId: 'asc' },
				select: { cardId: true, quantity: true, fromCollection: true },
			},
		},
	})
}

test('a NetrunnerDB decklist link becomes a deck with a link back', async () => {
	await insertCards()
	const user = await insertUser()
	const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		Response.json({
			data: {
				attributes: {
					name: 'Catalyst Corroder',
					card_slots: { the_catalyst: 1, corroder: 3, not_synced_yet: 2 },
				},
			},
		}),
	)

	const { deckId, unrecognized } = await importDeck(
		user.id,
		`https://netrunnerdb.com/en/decklist/${UUID}/catalyst`,
		{ formatId: 'eternal', requireLegality: false },
	)

	expect(fetchSpy).toHaveBeenCalledWith(
		`https://api.netrunnerdb.com/api/v3/public/decklists/${UUID}`,
		expect.anything(),
	)
	expect(unrecognized).toEqual(['2x card not_synced_yet'])
	expect(await savedDeck(deckId)).toEqual({
		name: 'Catalyst Corroder',
		sideId: 'runner',
		formatId: 'eternal',
		requireLegality: false,
		nrdbUrl: `https://netrunnerdb.com/en/decklist/${UUID}`,
		identityCardId: 'the_catalyst',
		identityFromCollection: 0,
		cards: [{ cardId: 'corroder', quantity: 3, fromCollection: 0 }],
	})
})

test('pasted text: the name, the identity, and unknown lines listed once', async () => {
	await insertCards()
	const user = await insertUser()
	const { deckId, unrecognized } = await importDeck(
		user.id,
		`Glacier
Haas-Bioroid: Precision Design
3x Hedge Fund
2x Not A Card`,
		{ ...options, name: '  ' },
	)
	expect(unrecognized).toEqual(['2x Not A Card'])
	expect(await savedDeck(deckId)).toMatchObject({
		name: 'Glacier',
		sideId: 'corp',
		identityCardId: 'precision_design',
		cards: [{ cardId: 'hedge_fund', quantity: 3 }],
	})

	// a name given with the import wins
	const named = await importDeck(user.id, '3x Hedge Fund', {
		...options,
		name: 'Mine',
	})
	expect(await savedDeck(named.deckId)).toMatchObject({ name: 'Mine' })
})

test('two identities: the first is the deck’s, the other a card the rules flag', async () => {
	await insertCards()
	const user = await insertUser()
	const { deckId } = await importDeck(
		user.id,
		'The Catalyst: Convention Breaker\n1x Haas-Bioroid: Precision Design\n2x Corroder',
		options,
	)
	const saved = await savedDeck(deckId)
	expect(saved).toMatchObject({
		sideId: 'runner',
		identityCardId: 'the_catalyst',
		cards: [
			{ cardId: 'corroder', quantity: 2 },
			{ cardId: 'precision_design', quantity: 1 },
		],
	})
	const deck = await getDeckForBuilder(user.id, deckId)
	expect(evaluateDeck(deck).problems.map((p) => p.code)).toContain(
		'identity_in_deck',
	)

	// it can be taken out, but not added to
	expect(
		await setDeckCardQuantity(user.id, deckId, 'precision_design', 2),
	).toMatchObject({ status: 400 })
	expect(
		await setDeckCardQuantity(user.id, deckId, 'precision_design', 0),
	).toEqual({ quantity: 0 })
	expect((await savedDeck(deckId)).cards).toEqual([
		{ cardId: 'corroder', quantity: 2, fromCollection: 0 },
	])
})

test('no identity: the side most cards are on, and a stand-in name', async () => {
	await insertCards()
	const user = await insertUser()
	const { deckId } = await importDeck(
		user.id,
		'3x Corroder\n1x Hedge Fund',
		options,
	)
	expect(await savedDeck(deckId)).toMatchObject({
		name: 'Imported deck',
		sideId: 'runner',
		identityCardId: null,
		cards: [
			{ cardId: 'corroder', quantity: 3 },
			{ cardId: 'hedge_fund', quantity: 1 },
		],
	})
	const deck = await getDeckForBuilder(user.id, deckId)
	expect(evaluateDeck(deck).problems.map((p) => p.code)).toEqual(
		expect.arrayContaining(['no_identity', 'wrong_side']),
	)
})

test('readDeckInput explains input it can’t use', async () => {
	await insertCards()
	await expect(readDeckInput('   ')).rejects.toThrow(/paste a decklist/i)
	await expect(readDeckInput('just some words')).rejects.toThrow(
		/couldn’t find any cards/i,
	)
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('not found', { status: 404 }),
	)
	await expect(readDeckInput(UUID)).rejects.toThrow(DeckImportError)

	// cards NetrunnerDB has but the card list doesn't yet
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		Response.json({
			data: { attributes: { name: 'New', card_slots: { brand_new: 3 } } },
		}),
	)
	const user = await insertUser()
	await expect(importDeck(user.id, UUID, options)).rejects.toThrow(
		/none of those cards/i,
	)
	expect(await prisma.deck.count()).toBe(0)
})

test('replacing a filled deck’s cards keeps what unchanged rows reserved', async () => {
	await insertCards()
	const user = await insertUser()
	// 3 Corroders (printing 30003) and the identity (30002)
	await prisma.collectionEntry.createMany({
		data: [
			{ userId: user.id, printingId: '30003', quantity: 3 },
			{ userId: user.id, printingId: '30002', quantity: 1 },
		],
	})
	const { deckId } = await importDeck(
		user.id,
		'The Catalyst: Convention Breaker\n3x Corroder\n2x Hedge Fund',
		options,
	)
	await fillDeck(user.id, deckId)
	expect(await savedDeck(deckId)).toMatchObject({
		identityFromCollection: 1,
		cards: [
			{ cardId: 'corroder', quantity: 3, fromCollection: 3 },
			{ cardId: 'hedge_fund', quantity: 2, fromCollection: 0 },
		],
	})

	const replaced = await replaceDeckCards(user.id, deckId, {
		name: 'ignored',
		nrdbUrl: null,
		cards: new Map([['corroder', 3]]),
		unrecognized: ['1x Mystery'],
	})
	expect(replaced).toEqual({ unrecognized: ['1x Mystery'], wasFilled: true })
	expect(await savedDeck(deckId)).toMatchObject({
		// the list had no identity: the deck keeps its own, still reserved
		name: 'The Catalyst: Convention Breaker',
		identityCardId: 'the_catalyst',
		identityFromCollection: 1,
		cards: [{ cardId: 'corroder', quantity: 3, fromCollection: 3 }],
	})

	// a changed count keeps at most its new count
	await replaceDeckCards(user.id, deckId, {
		name: null,
		nrdbUrl: null,
		cards: new Map([['corroder', 2]]),
		unrecognized: [],
	})
	expect((await savedDeck(deckId)).cards).toEqual([
		{ cardId: 'corroder', quantity: 2, fromCollection: 2 },
	])

	// a list for the other side takes its identity (unreserved)
	await replaceDeckCards(user.id, deckId, {
		name: null,
		nrdbUrl: `https://netrunnerdb.com/en/decklist/${UUID}`,
		cards: new Map([
			['precision_design', 1],
			['hedge_fund', 3],
		]),
		unrecognized: [],
	})
	expect(await savedDeck(deckId)).toMatchObject({
		sideId: 'corp',
		identityCardId: 'precision_design',
		identityFromCollection: 0,
		nrdbUrl: `https://netrunnerdb.com/en/decklist/${UUID}`,
		cards: [{ cardId: 'hedge_fund', quantity: 3, fromCollection: 0 }],
	})

	// only the owner
	const other = await insertUser()
	expect(
		await replaceDeckCards(other.id, deckId, {
			name: null,
			nrdbUrl: null,
			cards: new Map([['hedge_fund', 1]]),
			unrecognized: [],
		}),
	).toBeNull()
})
