import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import {
	createVariant,
	deleteVariant,
	searchCards,
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
})
