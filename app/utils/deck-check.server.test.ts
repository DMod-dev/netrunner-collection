import { afterEach, expect, test, vi } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { prisma } from './db.server.ts'
import {
	checkDeckAgainstCollection,
	DeckImportError,
	fetchNrdbDeck,
	parseDeckLine,
	parseDeckText,
	parseNrdbDeckRef,
} from './deck-check.server.ts'

afterEach(() => {
	vi.restoreAllMocks()
})

const UUID = '58bc5c41-88d9-4cb9-b950-0f132f508f3d'

test('parseNrdbDeckRef recognises published and shared deck links', () => {
	expect(
		parseNrdbDeckRef(`https://netrunnerdb.com/en/decklist/${UUID}/combo-pd`),
	).toEqual({ kind: 'decklist', id: UUID })
	expect(
		parseNrdbDeckRef(`https://netrunnerdb.com/en/deck/view/${UUID}`),
	).toEqual({ kind: 'deck', id: UUID })
	expect(parseNrdbDeckRef(`  ${UUID.toUpperCase()} `)).toEqual({
		kind: 'decklist',
		id: UUID,
	})
	expect(parseNrdbDeckRef(`https://example.com/${UUID}`)).toBeNull()
	expect(parseNrdbDeckRef('3x Hedge Fund')).toBeNull()
})

test('parseDeckLine handles common decklist formats', () => {
	expect(parseDeckLine('3x Hedge Fund')).toMatchObject({
		count: 3,
		name: 'Hedge Fund',
	})
	expect(parseDeckLine('2 Hedge Fund')).toMatchObject({ count: 2 })
	expect(parseDeckLine('Hedge Fund x2')).toMatchObject({
		count: 2,
		name: 'Hedge Fund',
	})
	expect(parseDeckLine('3x Sure Gamble ●●')).toMatchObject({
		count: 3,
		name: 'Sure Gamble',
	})
	expect(parseDeckLine('1 Carnivore (System Gateway)')).toMatchObject({
		name: 'Carnivore',
	})
	expect(parseDeckLine('Precision Design')).toMatchObject({
		count: null,
		name: 'Precision Design',
	})
	expect(parseDeckLine('Event (13)')).toBeNull()
	expect(parseDeckLine('45 cards')).toBeNull()
	expect(parseDeckLine('   ')).toBeNull()
})

async function insertCards() {
	await prisma.faction.create({
		data: { id: 'anarch', name: 'Anarch', sideId: 'runner' },
	})
	for (const [id, name] of [
		['event', 'Event'],
		['runner_identity', 'Runner Identity'],
	]) {
		await prisma.cardType.create({ data: { id: id!, name: name! } })
	}
	await prisma.cardCycle.create({ data: { id: 'sg', name: 'SG', position: 1 } })
	await prisma.cardSet.create({
		data: {
			id: 'sg',
			name: 'System Gateway',
			position: 1,
			size: 65,
			setTypeId: 'core',
			cycleId: 'sg',
		},
	})
	const cards = [
		[
			'loup',
			'René “Loup” Arcemont: Party Animal',
			'runner_identity',
			1,
			'30001',
		],
		['wildcat_strike', 'Wildcat Strike', 'event', 3, '30002'],
		['15_minutes', '15 Minutes', 'event', 1, '09004'],
	] as const
	for (const [id, title, typeId, deckLimit, printingId] of cards) {
		await prisma.card.create({
			data: {
				id,
				title,
				strippedTitle: title.replace(/[“”]/g, '"').replace('é', 'e'),
				sideId: 'runner',
				deckLimit,
				factionId: 'anarch',
				typeId,
				printings: {
					create: { id: printingId, position: 1, quantity: 3, setId: 'sg' },
				},
			},
		})
	}
}

test('parseDeckText matches names loosely and reports unknown cards', async () => {
	await insertCards()
	const deck = await parseDeckText(`My Loup deck
Rene "Loup" Arcemont: Party Animal
Event (7)
2x Wildcat Strike
wildcat strike x1
1 15 Minutes
3x Not A Real Card`)

	expect(deck.name).toBe('My Loup deck')
	expect(Object.fromEntries(deck.cards)).toEqual({
		loup: 1,
		wildcat_strike: 3,
		'15_minutes': 1,
	})
	expect(deck.unrecognized).toEqual(['3x Not A Real Card'])
})

test('checkDeckAgainstCollection counts every printing and version', async () => {
	await insertCards()
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	await prisma.collectionEntry.create({
		data: { userId: user.id, printingId: '30002', quantity: 1 },
	})
	await prisma.variant.create({
		data: {
			userId: user.id,
			printingId: '30002',
			label: 'Alt art',
			quantity: 1,
		},
	})

	const result = await checkDeckAgainstCollection(user.id, {
		name: 'Test',
		nrdbUrl: null,
		cards: new Map([
			['loup', 1],
			['wildcat_strike', 3],
		]),
		unrecognized: [],
	})

	expect(result).toMatchObject({
		totalCards: 4,
		missingCards: 2,
		missingUnique: 2,
	})
	// identity first
	expect(result.rows.map((r) => r.id)).toEqual(['loup', 'wildcat_strike'])
	expect(result.rows[1]).toMatchObject({ owned: 2, missing: 1 })
	expect(result.rows[1]?.sources).toEqual([
		{ label: 'System Gateway', quantity: 1 },
		{ label: 'System Gateway – Alt art', quantity: 1 },
	])
})

test('fetchNrdbDeck maps shared decks from printing codes to cards', async () => {
	await insertCards()
	const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		Response.json({
			data: [
				{ name: 'Shared deck', cards: { '30001': 1, '30002': 3, '99999': 2 } },
			],
		}),
	)

	const deck = await fetchNrdbDeck({ kind: 'deck', id: UUID })

	expect(fetchSpy).toHaveBeenCalledWith(
		`https://netrunnerdb.com/api/2.0/public/deck/${UUID}`,
	)
	expect(deck.name).toBe('Shared deck')
	expect(Object.fromEntries(deck.cards)).toEqual({
		loup: 1,
		wildcat_strike: 3,
	})
	expect(deck.unrecognized).toEqual(['2x card #99999'])
})

test('fetchNrdbDeck explains decks that are missing or not shared', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('not found', { status: 404 }),
	)
	await expect(fetchNrdbDeck({ kind: 'deck', id: UUID })).rejects.toThrow(
		DeckImportError,
	)
	await expect(fetchNrdbDeck({ kind: 'decklist', id: UUID })).rejects.toThrow(
		/published decklist/,
	)
})
