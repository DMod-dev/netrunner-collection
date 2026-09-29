import { gzipSync } from 'node:zlib'
import { expect, test, vi } from 'vitest'
import { MTG_CARDS, MTG_SETS, mtgFixture } from '#tests/fixtures/mtg.ts'
import { insertMtgCards } from '#tests/mtg-db.ts'
import { prisma } from './db.server.ts'
import {
	isMtgAutoSyncEnabled,
	isMtgSyncRunning,
	MTG_SYNC_EVERY_MS,
	mtgSyncIfDue,
	readCardObjects,
	runRecordedMtgSync,
	SCRYFALL_USER_AGENT,
	type ScryfallCard,
	syncFromScryfall,
} from './scryfall.server.ts'

const BULK_URI = 'https://data.scryfall.io/default-cards/default-cards.jsonl.gz'

/** Serve a bulk-data listing, /sets and a gzipped JSON Lines bulk file. */
function mockScryfall({
	cards = MTG_CARDS,
	updatedAt = '2026-09-29T09:05:55.334+00:00',
}: { cards?: Array<ScryfallCard>; updatedAt?: string } = {}) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = input instanceof Request ? input.url : String(input)
		if (url === 'https://api.scryfall.com/bulk-data') {
			return Response.json({
				object: 'list',
				data: [
					{ type: 'oracle_cards', updated_at: updatedAt },
					{
						type: 'default_cards',
						updated_at: updatedAt,
						jsonl_download_uri: BULK_URI,
					},
				],
			})
		}
		if (url === 'https://api.scryfall.com/sets') {
			return Response.json({ object: 'list', has_more: false, data: MTG_SETS })
		}
		if (url === BULK_URI) {
			const jsonl = cards.map((c) => JSON.stringify(c)).join('\n') + '\n'
			return new Response(gzipSync(jsonl), {
				headers: { 'content-type': 'application/gzip' },
			})
		}
		return new Response('not found', { status: 404 })
	})
}

const DIGITAL_ONLY: ScryfallCard = {
	...mtgFixture('Lightning Bolt'),
	id: 'digital-bolt',
	set_id: 'digital-set',
	set: 'ydig',
	set_name: 'Alchemy: Digital',
	digital: true,
}

test('imports cards, printings and sets from the streamed bulk file', async () => {
	const fetchSpy = mockScryfall({ cards: [...MTG_CARDS, DIGITAL_ONLY] })

	const summary = await syncFromScryfall()
	expect(summary).toMatchObject({
		skipped: false,
		sets: MTG_SETS.length,
		cards: 31,
		printings: 32,
		cardsWritten: 31,
		printingsWritten: 32,
		digitalSkipped: 1,
		printingsDeleted: 0,
		bulkUpdatedAt: '2026-09-29T09:05:55.334Z',
	})
	expect(await prisma.mtgPrinting.count()).toBe(32)
	expect(
		await prisma.mtgPrinting.count({ where: { id: 'digital-bolt' } }),
	).toBe(0)
	// Scryfall can see who's calling
	expect(fetchSpy).toHaveBeenCalledWith(
		BULK_URI,
		expect.objectContaining({
			headers: expect.objectContaining({ 'user-agent': SCRYFALL_USER_AGENT }),
		}),
	)

	const atraxa = await prisma.mtgCard.findFirstOrThrow({
		where: { name: "Atraxa, Praetors' Voice" },
	})
	expect(atraxa).toMatchObject({
		strippedName: "atraxa, praetors' voice",
		manaCost: '{G}{W}{U}{B}',
		manaValue: 4,
		colors: ',B,G,U,W,',
		colorIdentity: ',B,G,U,W,',
		types: ',legendary,creature,',
		subtypes: ',phyrexian,angel,horror,',
		keywords: ',deathtouch,flying,lifelink,vigilance,proliferate,',
		power: '4',
		toughness: '4',
		faces: null,
	})
	expect(atraxa.legalFormats).toContain(',commander,')
	expect(atraxa.legalFormats).not.toContain(',standard,')

	const dockside = await prisma.mtgCard.findFirstOrThrow({
		where: { name: 'Dockside Extortionist' },
	})
	expect(dockside.bannedFormats).toContain(',commander,')
	expect(dockside.legalFormats).not.toContain(',commander,')
	const solRing = await prisma.mtgCard.findFirstOrThrow({
		where: { name: 'Sol Ring' },
		include: { printings: { orderBy: { id: 'asc' } } },
	})
	expect(solRing.restrictedFormats).toContain(',vintage,')
	expect(solRing.producedMana).toBe(',C,')
	expect(solRing.printings.map((p) => p.finishes).sort()).toEqual([
		',etched,',
		',nonfoil,foil,',
	])
	expect(
		await prisma.mtgCard.findFirstOrThrow({
			where: { name: "Gaea's Cradle" },
			select: { reserved: true, gameChanger: true },
		}),
	).toEqual({ reserved: true, gameChanger: true })
})

test('maps multi-face cards and printings', async () => {
	await insertMtgCards()

	const delver = await prisma.mtgCard.findFirstOrThrow({
		where: { name: 'Delver of Secrets // Insectile Aberration' },
		include: { printings: true },
	})
	expect(delver).toMatchObject({
		layout: 'transform',
		manaCost: '{U}',
		manaValue: 1,
		colors: ',U,',
		types: ',creature,',
		subtypes: ',human,wizard,insect,',
		power: '1',
		toughness: '1',
	})
	expect(JSON.parse(delver.faces!)).toEqual([
		expect.objectContaining({
			name: 'Delver of Secrets',
			manaCost: '{U}',
			typeLine: 'Creature — Human Wizard',
		}),
		expect.objectContaining({
			name: 'Insectile Aberration',
			typeLine: 'Creature — Human Insect',
			power: '3',
			toughness: '2',
		}),
	])
	// no mana cost on the back face, so the key is left out
	expect((JSON.parse(delver.faces!) as Array<object>)[1]).not.toHaveProperty(
		'manaCost',
	)
	expect(delver.printings[0]).toMatchObject({ multiFaceImages: true })
	expect(delver.printings[0]!.illustrationId).toBeTruthy()

	const emeria = await prisma.mtgCard.findFirstOrThrow({
		where: { name: "Emeria's Call // Emeria, Shattered Skyclave" },
	})
	expect(emeria).toMatchObject({
		layout: 'modal_dfc',
		manaCost: '{4}{W}{W}{W}',
		types: ',sorcery,land,',
	})

	const fireIce = await prisma.mtgCard.findFirstOrThrow({
		where: { name: 'Fire // Ice' },
		include: { printings: true },
	})
	expect(fireIce).toMatchObject({
		layout: 'split',
		manaCost: '{1}{R} // {1}{U}',
		colors: ',R,U,',
		types: ',instant,',
	})
	expect(fireIce.oracleText).toContain('//')
	expect(fireIce.printings[0]).toMatchObject({ multiFaceImages: false })

	// a reversible card has its oracle id on the faces
	const reversible = mtgFixture(
		"Jinnie Fay, Jetmir's Second // Jinnie Fay, Jetmir's Second",
	)
	expect(reversible.oracle_id).toBeUndefined()
	expect(
		await prisma.mtgPrinting.findUniqueOrThrow({
			where: { id: reversible.id },
			select: { cardId: true },
		}),
	).toEqual({ cardId: reversible.card_faces![0]!.oracle_id })

	const bolt = mtgFixture('Lightning Bolt')
	expect(
		await prisma.mtgPrinting.findUniqueOrThrow({ where: { id: bolt.id } }),
	).toMatchObject({
		setId: bolt.set_id,
		collectorNumber: bolt.collector_number,
		rarity: bolt.rarity,
		lang: 'en',
		imageStatus: bolt.image_status,
		priceUsd: bolt.prices?.usd ? Number(bolt.prices.usd) : null,
	})
	expect(await prisma.mtgSet.count()).toBe(MTG_SETS.length)
})

test('skips an unchanged file, and a forced re-run rewrites nothing', async () => {
	mockScryfall()
	await runRecordedMtgSync({ trigger: 'cli' })

	const again = await runRecordedMtgSync({ trigger: 'cli' })
	expect(again).toMatchObject({ skipped: true, printingsWritten: 0 })

	const updatedAt = await prisma.mtgPrinting.findFirstOrThrow({
		select: { id: true, updatedAt: true },
	})
	const forced = await runRecordedMtgSync({ trigger: 'manual', force: true })
	expect(forced).toMatchObject({
		skipped: false,
		printings: 32,
		cardsWritten: 0,
		printingsWritten: 0,
	})
	// unchanged rows aren't touched at all
	expect(
		await prisma.mtgPrinting.findUniqueOrThrow({
			where: { id: updatedAt.id },
			select: { id: true, updatedAt: true },
		}),
	).toEqual(updatedAt)
	expect(await prisma.mtgPrinting.count()).toBe(32)

	const runs = await prisma.mtgSync.findMany({
		orderBy: { startedAt: 'asc' },
		select: { status: true, trigger: true, bulkUpdatedAt: true },
	})
	expect(runs).toEqual([
		{ status: 'success', trigger: 'cli', bulkUpdatedAt: expect.any(Date) },
		{ status: 'success', trigger: 'cli', bulkUpdatedAt: expect.any(Date) },
		{ status: 'success', trigger: 'manual', bulkUpdatedAt: expect.any(Date) },
	])
})

test('a new file updates only what changed', async () => {
	const fetchSpy = mockScryfall()
	await syncFromScryfall()

	const bolt = mtgFixture('Lightning Bolt')
	const krenko = mtgFixture('Krenko, Mob Boss')
	fetchSpy.mockRestore()
	mockScryfall({
		updatedAt: '2026-09-30T09:00:00.000+00:00',
		cards: MTG_CARDS.map((card) => {
			if (card.id === bolt.id) {
				return { ...card, prices: { ...card.prices, usd: '123.45' } }
			}
			if (card.id === krenko.id) {
				return {
					...card,
					legalities: { ...card.legalities, commander: 'banned' },
				}
			}
			return card
		}),
	})
	const summary = await syncFromScryfall()
	expect(summary).toMatchObject({ cardsWritten: 1, printingsWritten: 1 })
	expect(
		await prisma.mtgPrinting.findUniqueOrThrow({
			where: { id: bolt.id },
			select: { priceUsd: true },
		}),
	).toEqual({ priceUsd: 123.45 })
	expect(
		(
			await prisma.mtgCard.findUniqueOrThrow({
				where: { id: krenko.oracle_id },
			})
		).bannedFormats,
	).toContain(',commander,')
})

test('removes printings Scryfall dropped, unless user data refers to them', async () => {
	const fetchSpy = mockScryfall()
	await syncFromScryfall()

	// Stand-in for a collection row (the MTG collection tables come later):
	// any foreign key to a printing must keep it.
	await prisma.$executeRawUnsafe(
		`CREATE TABLE "OwnedPrintingStub" ("printingId" TEXT NOT NULL REFERENCES "MtgPrinting" ("id") ON DELETE RESTRICT)`,
	)
	const owned = mtgFixture('Counterspell')
	await prisma.$executeRawUnsafe(
		`INSERT INTO "OwnedPrintingStub" ("printingId") VALUES (?)`,
		owned.id,
	)

	const dropped = [mtgFixture('Cultivate'), owned]
	const solRingEtched = MTG_CARDS.find(
		(c) => c.name === 'Sol Ring' && c.finishes?.includes('etched'),
	)!
	fetchSpy.mockRestore()
	mockScryfall({
		updatedAt: '2026-09-30T09:00:00.000+00:00',
		cards: MTG_CARDS.filter((c) => !dropped.includes(c) && c !== solRingEtched),
	})
	const summary = await syncFromScryfall()
	expect(summary).toMatchObject({
		printings: 29,
		printingsDeleted: 2,
		printingsKept: 1,
		// Cultivate's only printing went; Sol Ring still has one
		cardsDeleted: 1,
	})
	expect(
		await prisma.mtgPrinting.findMany({
			where: { id: { in: [...dropped, solRingEtched].map((c) => c.id) } },
			select: { id: true },
		}),
	).toEqual([{ id: owned.id }])
	expect(await prisma.mtgCard.count({ where: { name: 'Cultivate' } })).toBe(0)
	expect(await prisma.mtgCard.count({ where: { name: 'Counterspell' } })).toBe(
		1,
	)
	expect(await prisma.mtgCard.count({ where: { name: 'Sol Ring' } })).toBe(1)
})

test('a card whose printings all moved to another Oracle id is removed', async () => {
	const fetchSpy = mockScryfall()
	await syncFromScryfall()

	const bolt = mtgFixture('Lightning Bolt')
	const mergedInto = '00000000-0000-4000-8000-000000000001'
	fetchSpy.mockRestore()
	mockScryfall({
		updatedAt: '2026-09-30T09:00:00.000+00:00',
		cards: MTG_CARDS.map((card) =>
			card.id === bolt.id ? { ...card, oracle_id: mergedInto } : card,
		),
	})
	const summary = await syncFromScryfall()
	expect(summary).toMatchObject({ printingsDeleted: 0, cardsDeleted: 1 })
	expect(
		await prisma.mtgPrinting.findUniqueOrThrow({
			where: { id: bolt.id },
			select: { cardId: true },
		}),
	).toEqual({ cardId: mergedInto })
	expect(await prisma.mtgCard.count({ where: { id: bolt.oracle_id } })).toBe(0)
})

test('lands have no mana cost', async () => {
	await insertMtgCards()
	expect(
		await prisma.mtgCard.findFirstOrThrow({
			where: { name: 'Command Tower' },
			select: { manaCost: true, manaValue: true, types: true },
		}),
	).toEqual({ manaCost: null, manaValue: 0, types: ',land,' })
})

test('a failed download is recorded and changes nothing', async () => {
	vi.spyOn(console, 'error').mockImplementation(() => {})
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async () =>
			new Response('down', { status: 503, statusText: 'Unavailable' }),
	)
	await expect(runRecordedMtgSync()).rejects.toThrow(/503/)
	expect(await isMtgSyncRunning()).toBe(false)
	expect(await prisma.mtgSync.findFirstOrThrow()).toMatchObject({
		status: 'error',
		error: expect.stringMatching(/503/),
	})
	expect(await prisma.mtgCard.count()).toBe(0)
})

test('mtgSyncIfDue waits 12 hours between successful syncs', async () => {
	const now = Date.now()
	await prisma.mtgSync.create({
		data: {
			status: 'success',
			startedAt: new Date(now - MTG_SYNC_EVERY_MS + 60_000),
		},
	})
	expect(await mtgSyncIfDue({ now })).toBe(false)
	expect(await prisma.mtgSync.count()).toBe(1)
})

test('reads JSON Lines and one-object-per-line JSON arrays, gzipped or not', async () => {
	const [a, b] = [mtgFixture('Forest'), mtgFixture('Island')]
	async function read(response: Response) {
		const names: Array<string> = []
		for await (const card of readCardObjects(response)) names.push(card.name)
		return names
	}
	const lines = `${JSON.stringify(a)}\n${JSON.stringify(b)}`
	expect(await read(new Response(lines))).toEqual(['Forest', 'Island'])
	const array = `[\n${JSON.stringify(a)},\n${JSON.stringify(b)}\n]\n`
	expect(
		await read(
			new Response(gzipSync(array), {
				headers: { 'content-type': 'application/gzip' },
			}),
		),
	).toEqual(['Forest', 'Island'])
	// a truncated gzip stream fails rather than importing half a file
	const truncated = gzipSync(lines).subarray(0, 40)
	await expect(
		read(
			new Response(truncated, {
				headers: { 'content-type': 'application/gzip' },
			}),
		),
	).rejects.toThrow(/unexpected end of file/i)
})

test('auto sync is off with mocks, in tests, or when disabled', () => {
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('MOCKS', '')
	vi.stubEnv('MTG_AUTO_SYNC', '')
	expect(isMtgAutoSyncEnabled()).toBe(true)
	vi.stubEnv('MTG_AUTO_SYNC', 'false')
	expect(isMtgAutoSyncEnabled()).toBe(false)
	vi.stubEnv('MTG_AUTO_SYNC', '')
	vi.stubEnv('MOCKS', 'true')
	expect(isMtgAutoSyncEnabled()).toBe(false)
	vi.stubEnv('MOCKS', '')
	vi.stubEnv('NODE_ENV', 'test')
	expect(isMtgAutoSyncEnabled()).toBe(false)
})
