import { type Prisma } from '@prisma/client'
import { MAX_QUANTITY } from './collection.ts'
import { prisma } from './db.server.ts'

export const CARDS_PER_PAGE = 24

export type CardSearchParams = {
	q?: string
	side?: string
	faction?: string
	type?: string
	set?: string
	format?: string
	owned?: 'owned' | 'missing'
	page?: number
}

function clampQuantity(quantity: number) {
	return Math.max(0, Math.min(MAX_QUANTITY, Math.trunc(quantity)))
}

/** Matches printings the user owns at least one copy of (plain or variant). */
function ownedPrintingWhere(userId: string): Prisma.PrintingWhereInput {
	return {
		OR: [
			{ collectionEntries: { some: { userId, quantity: { gt: 0 } } } },
			{ variants: { some: { userId, quantity: { gt: 0 } } } },
		],
	}
}

export async function searchCards(userId: string, params: CardSearchParams) {
	const q = params.q?.trim()
	const where: Prisma.CardWhereInput = {
		AND: [
			q
				? {
						OR: [
							{ title: { contains: q } },
							{ strippedTitle: { contains: q } },
						],
					}
				: {},
			params.side ? { sideId: params.side } : {},
			params.faction ? { factionId: params.faction } : {},
			params.type ? { typeId: params.type } : {},
			params.format ? { legalFormats: { contains: `,${params.format},` } } : {},
			params.set ? { printings: { some: { setId: params.set } } } : {},
			params.owned === 'owned'
				? { printings: { some: ownedPrintingWhere(userId) } }
				: {},
			params.owned === 'missing'
				? { printings: { none: ownedPrintingWhere(userId) } }
				: {},
		],
	}

	const page = Math.max(1, params.page ?? 1)
	const [total, cards] = await Promise.all([
		prisma.card.count({ where }),
		prisma.card.findMany({
			where,
			orderBy: { title: 'asc' },
			skip: (page - 1) * CARDS_PER_PAGE,
			take: CARDS_PER_PAGE,
			select: {
				id: true,
				title: true,
				sideId: true,
				displaySubtypes: true,
				text: true,
				deckLimit: true,
				cost: true,
				influenceCost: true,
				faction: { select: { id: true, name: true } },
				type: { select: { id: true, name: true } },
				printings: {
					orderBy: { dateRelease: 'desc' },
					select: printingSelect(userId),
				},
			},
		}),
	])

	return {
		total,
		page,
		pageCount: Math.max(1, Math.ceil(total / CARDS_PER_PAGE)),
		cards,
	}
}

/** The fields every printing tile needs, including this user's counts. */
export function printingSelect(userId: string) {
	return {
		id: true,
		position: true,
		quantity: true,
		illustrator: true,
		imageSmall: true,
		imageLarge: true,
		set: { select: { id: true, name: true } },
		collectionEntries: {
			where: { userId },
			select: { quantity: true },
		},
		variants: {
			where: { userId },
			orderBy: { createdAt: 'asc' },
			select: { id: true, label: true, notes: true, quantity: true },
		},
	} satisfies Prisma.PrintingSelect
}

export async function getFilterOptions() {
	const [factions, types, cycles] = await Promise.all([
		prisma.faction.findMany({
			orderBy: [{ sideId: 'asc' }, { isMini: 'asc' }, { name: 'asc' }],
			select: { id: true, name: true, sideId: true },
		}),
		prisma.cardType.findMany({
			orderBy: { name: 'asc' },
			select: { id: true, name: true },
		}),
		prisma.cardCycle.findMany({
			orderBy: { position: 'desc' },
			select: {
				id: true,
				name: true,
				sets: {
					orderBy: { position: 'asc' },
					select: { id: true, name: true },
				},
			},
		}),
	])
	return { factions, types, cycles }
}

export async function setPrintingQuantity(
	userId: string,
	printingId: string,
	quantity: number,
) {
	const clamped = clampQuantity(quantity)
	if (clamped === 0) {
		await prisma.collectionEntry.deleteMany({ where: { userId, printingId } })
		return 0
	}
	await prisma.collectionEntry.upsert({
		where: { userId_printingId: { userId, printingId } },
		create: { userId, printingId, quantity: clamped },
		update: { quantity: clamped },
	})
	return clamped
}

export async function createVariant(
	userId: string,
	data: {
		printingId: string
		label: string
		notes?: string
		quantity?: number
	},
) {
	return prisma.variant.create({
		data: {
			userId,
			printingId: data.printingId,
			label: data.label.trim(),
			notes: data.notes?.trim() || null,
			quantity: clampQuantity(data.quantity ?? 1),
		},
		select: { id: true },
	})
}

export async function setVariantQuantity(
	userId: string,
	variantId: string,
	quantity: number,
) {
	const clamped = clampQuantity(quantity)
	// updateMany so a user can only ever touch their own variants
	const { count } = await prisma.variant.updateMany({
		where: { id: variantId, userId },
		data: { quantity: clamped },
	})
	return count ? clamped : null
}

export async function deleteVariant(userId: string, variantId: string) {
	const { count } = await prisma.variant.deleteMany({
		where: { id: variantId, userId },
	})
	return count > 0
}
