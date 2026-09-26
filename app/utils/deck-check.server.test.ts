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
import { NRDB_USER_AGENT } from './nrdb.server.ts'

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
		expect.objectContaining({
			headers: { 'user-agent': NRDB_USER_AGENT },
			signal: expect.any(AbortSignal),
		}),
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

test('fetchNrdbDeck gives up on a hung NetrunnerDB with a user-facing error', async () => {
	// behaves like a real fetch: never resolves, rejects with the signal's
	// reason once the timeout aborts it
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		(_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () =>
					reject(init.signal?.reason),
				)
			}),
	)
	const started = Date.now()
	await expect(
		fetchNrdbDeck({ kind: 'decklist', id: UUID }, { timeoutMs: 50 }),
	).rejects.toThrow(/didn't respond in time/)
	expect(Date.now() - started).toBeLessThan(5_000)
})

test('fetchNrdbDeck explains a network failure', async () => {
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
	await expect(fetchNrdbDeck({ kind: 'deck', id: UUID })).rejects.toThrow(
		/couldn't reach netrunnerdb/i,
	)
})

test('the title index is kept until the next successful NRDB sync', async () => {
	await insertCards()
	const newCard = async (id: string, title: string, printingId: string) =>
		prisma.card.create({
			data: {
				id,
				title,
				strippedTitle: title,
				sideId: 'runner',
				deckLimit: 3,
				factionId: 'anarch',
				typeId: 'event',
				printings: {
					create: { id: printingId, position: 9, quantity: 3, setId: 'sg' },
				},
			},
		})

	// without a recorded sync nothing is cached
	await newCard('sure_gamble', 'Sure Gamble', '30010')
	expect([...(await parseDeckText('3x Sure Gamble')).cards.keys()]).toEqual([
		'sure_gamble',
	])

	// a successful sync keys the cache; cards added afterwards are invisible…
	await prisma.nrdbSync.create({
		data: {
			status: 'success',
			finishedAt: new Date(),
			// unique per test run so a stale entry from another test can't match
			startedAt: new Date(
				Date.now() - 7 * 24 * 60 * 60_000 - Math.random() * 1e6,
			),
		},
	})
	expect((await parseDeckText('3x Sure Gamble')).cards.size).toBe(1)
	await newCard('dirty_laundry', 'Dirty Laundry', '30011')
	expect((await parseDeckText('2x Dirty Laundry')).unrecognized).toEqual([
		'2x Dirty Laundry',
	])

	// …until the next sync
	await prisma.nrdbSync.create({
		data: { status: 'success', finishedAt: new Date(), startedAt: new Date() },
	})
	expect([...(await parseDeckText('2x Dirty Laundry')).cards.keys()]).toEqual([
		'dirty_laundry',
	])
})

test('checkDeckAgainstCollection shows copies other decks hold', async () => {
	await insertCards()
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	await prisma.collectionEntry.create({
		data: { userId: user.id, printingId: '30002', quantity: 3 },
	})
	await prisma.deck.create({
		data: {
			userId: user.id,
			name: 'Filled',
			sideId: 'runner',
			cards: {
				create: { cardId: 'wildcat_strike', quantity: 2, fromCollection: 2 },
			},
		},
	})

	const result = await checkDeckAgainstCollection(user.id, {
		name: null,
		nrdbUrl: null,
		cards: new Map([['wildcat_strike', 3]]),
		unrecognized: [],
	})

	expect(result).toMatchObject({ missingCards: 0, inUseCards: 2 })
	expect(result.rows[0]).toMatchObject({
		owned: 3,
		missing: 0,
		reservedElsewhere: 2,
		reservedBy: [{ name: 'Filled', quantity: 2 }],
		status: { kind: 'inUseElsewhere', need: 0, inUse: 2 },
	})
})
