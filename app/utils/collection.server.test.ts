import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import {
	addProductCopies,
	clearPreferredPrinting,
	createVariant,
	deleteVariant,
	getSetCompletion,
	getSetsProgress,
	searchCards,
	setPreferredPrinting,
	setPrintingQuantity,
	setVariantQuantity,
} from './collection.server.ts'
import { prisma } from './db.server.ts'

async function insertPrinting() {
	await prisma.faction.create({
		data: { id: 'anarch', name: 'Anarch', sideId: 'runner' },
	})
	await prisma.cardType.create({ data: { id: 'program', name: 'Program' } })
	await prisma.cardCycle.create({
		data: { id: 'sg', name: 'System Gateway', position: 1 },
	})
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
	await prisma.card.create({
		data: {
			id: 'corroder',
			title: 'Corroder',
			strippedTitle: 'Corroder',
			sideId: 'runner',
			deckLimit: 3,
			legalFormats: ',standard,startup,',
			factionId: 'anarch',
			typeId: 'program',
		},
	})
	return prisma.printing.create({
		data: {
			id: '30020',
			position: 20,
			quantity: 2,
			cardId: 'corroder',
			setId: 'sg',
		},
	})
}

async function insertUser() {
	return prisma.user.create({ data: createUser(), select: { id: true } })
}

test('setPrintingQuantity clamps, upserts and removes empty entries', async () => {
	const printing = await insertPrinting()
	const user = await insertUser()

	expect(await setPrintingQuantity(user.id, printing.id, 3)).toBe(3)
	expect(await setPrintingQuantity(user.id, printing.id, 500)).toBe(99)
	expect(
		await prisma.collectionEntry.findUniqueOrThrow({
			where: {
				userId_printingId: { userId: user.id, printingId: printing.id },
			},
		}),
	).toMatchObject({ quantity: 99 })

	expect(await setPrintingQuantity(user.id, printing.id, 0)).toBe(0)
	expect(await prisma.collectionEntry.count()).toBe(0)
})

test('variants can only be changed by their owner', async () => {
	const printing = await insertPrinting()
	const owner = await insertUser()
	const other = await insertUser()

	const variant = await createVariant(owner.id, {
		printingId: printing.id,
		label: '  Worlds alt art  ',
	})
	expect(
		await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } }),
	).toMatchObject({ label: 'Worlds alt art', quantity: 1 })

	expect(await setVariantQuantity(other.id, variant.id, 5)).toBeNull()
	expect(await deleteVariant(other.id, variant.id)).toBe(false)

	expect(await setVariantQuantity(owner.id, variant.id, 2)).toBe(2)
	expect(await deleteVariant(owner.id, variant.id)).toBe(true)
})

test('searchCards filters by ownership across printings and variants', async () => {
	const printing = await insertPrinting()
	const user = await insertUser()

	expect((await searchCards(user.id, { owned: 'owned' })).total).toBe(0)
	expect((await searchCards(user.id, { owned: 'missing' })).total).toBe(1)

	await createVariant(user.id, { printingId: printing.id, label: 'Foil' })
	const owned = await searchCards(user.id, { owned: 'owned', q: 'corr' })
	expect(owned.total).toBe(1)
	expect(owned.cards[0]?.printings[0]?.variants).toHaveLength(1)

	expect((await searchCards(user.id, { format: 'eternal' })).total).toBe(0)
	expect((await searchCards(user.id, { format: 'startup' })).total).toBe(1)

	const factions = (ids: string[]) =>
		searchCards(user.id, { factions: ids }).then((r) => r.total)
	expect(await factions(['criminal'])).toBe(0)
	expect(await factions(['criminal', 'anarch'])).toBe(1)
})

test('searchCards groups neutrals and mini-factions, and takes several sides', async () => {
	await prisma.cardType.create({ data: { id: 'event', name: 'Event' } })
	const factions = [
		{ id: 'anarch', sideId: 'runner', isMini: false },
		{ id: 'neutral_runner', sideId: 'runner', isMini: false },
		{ id: 'neutral_corp', sideId: 'corp', isMini: false },
		{ id: 'apex', sideId: 'runner', isMini: true },
		{ id: 'adam', sideId: 'runner', isMini: true },
	]
	for (const { id, sideId, isMini } of factions) {
		await prisma.faction.create({ data: { id, name: id, sideId, isMini } })
		await prisma.card.create({
			data: {
				id,
				title: id,
				strippedTitle: id,
				sideId,
				deckLimit: 3,
				factionId: id,
				typeId: 'event',
			},
		})
	}
	const user = await insertUser()
	const titles = (params: Parameters<typeof searchCards>[1]) =>
		searchCards(user.id, params).then((r) => r.cards.map((c) => c.title))

	expect(await titles({ factions: ['neutral'] })).toEqual([
		'neutral_corp',
		'neutral_runner',
	])
	expect(await titles({ factions: ['neutral'], sides: ['corp'] })).toEqual([
		'neutral_corp',
	])
	expect(await titles({ factions: ['mini', 'anarch'] })).toEqual([
		'adam',
		'anarch',
		'apex',
	])
	expect(await titles({ sides: ['corp', 'runner'] })).toHaveLength(5)
})

test('set completion counts exact printings "as printed" and any printing for playsets', async () => {
	const sgPrinting = await insertPrinting() // Corroder, 2 per System Gateway
	await prisma.cardCycle.create({
		data: { id: 'core', name: 'Core Set', position: 0 },
	})
	await prisma.cardSet.create({
		data: {
			id: 'core',
			name: 'Core Set',
			position: 1,
			size: 113,
			setTypeId: 'core',
			cycleId: 'core',
		},
	})
	await prisma.printing.create({
		data: {
			id: '01007',
			position: 7,
			quantity: 3,
			cardId: 'corroder',
			setId: 'core',
		},
	})
	const user = await insertUser()
	// 1 plain copy and 1 alt art of the System Gateway printing
	await setPrintingQuantity(user.id, sgPrinting.id, 1)
	await createVariant(user.id, { printingId: sgPrinting.id, label: 'Alt art' })

	const asPrinted = await getSetCompletion(user.id, 'sg', 'product')
	expect(asPrinted).toMatchObject({ have: 2, need: 2 })
	// the old Core Set printing isn't owned
	expect(await getSetCompletion(user.id, 'core', 'product')).toMatchObject({
		have: 0,
		need: 3,
	})

	// for playing, the 2 System Gateway copies count toward Core Set's Corroder
	const playset = await getSetCompletion(user.id, 'core', 'playset')
	expect(playset).toMatchObject({ have: 2, need: 3 })
	expect(playset?.printings[0]?.progress).toEqual({
		owned: 2,
		have: 2,
		need: 3,
	})

	const cycles = await getSetsProgress(user.id, 'product')
	expect(cycles.map((c) => c.id)).toEqual(['sg', 'core'])
	expect(cycles[0]?.sets[0]).toMatchObject({
		have: 2,
		need: 2,
		cardCount: 1,
		completeCards: 1,
	})

	expect(await getSetCompletion(user.id, 'nope', 'product')).toBeNull()
})

test('addProductCopies adds and removes whole products of plain copies', async () => {
	const printing = await insertPrinting() // 2 per product
	const user = await insertUser()
	await setPrintingQuantity(user.id, printing.id, 1)
	await createVariant(user.id, { printingId: printing.id, label: 'Foil' })

	expect(await addProductCopies(user.id, 'sg', 3)).toEqual({ changed: 6 })
	const entry = () =>
		prisma.collectionEntry.findUnique({
			where: {
				userId_printingId: { userId: user.id, printingId: printing.id },
			},
		})
	expect(await entry()).toMatchObject({ quantity: 7 })

	// removing more than is owned stops at zero and deletes the entry
	expect(await addProductCopies(user.id, 'sg', -10)).toEqual({ changed: -7 })
	expect(await entry()).toBeNull()
	// custom versions are untouched
	expect(await prisma.variant.count({ where: { userId: user.id } })).toBe(1)

	expect(await addProductCopies(user.id, 'sg', -1)).toEqual({ changed: 0 })
	expect(await addProductCopies(user.id, 'nope', 1)).toBeNull()
})

test('setPreferredPrinting saves one art per card, and clearPreferredPrinting forgets it', async () => {
	const sgPrinting = await insertPrinting()
	await prisma.cardCycle.create({
		data: { id: 'core', name: 'Core', position: 0 },
	})
	await prisma.cardSet.create({
		data: {
			id: 'core',
			name: 'Core Set',
			position: 0,
			size: 113,
			setTypeId: 'core',
			cycleId: 'core',
		},
	})
	const corePrinting = await prisma.printing.create({
		data: {
			id: '01007',
			position: 7,
			quantity: 2,
			cardId: 'corroder',
			setId: 'core',
		},
	})
	const user = await insertUser()
	const preferred = () =>
		searchCards(user.id, {}).then((r) => r.cards[0]?.preferredArt)

	expect(await preferred()).toEqual([])
	expect(await setPreferredPrinting(user.id, corePrinting.id)).toBe(true)
	expect(await setPreferredPrinting(user.id, sgPrinting.id)).toBe(true)
	expect(await preferred()).toEqual([{ printingId: sgPrinting.id }])
	expect(await setPreferredPrinting(user.id, 'no-such-printing')).toBe(false)

	await clearPreferredPrinting(user.id, 'corroder')
	expect(await preferred()).toEqual([])
})
