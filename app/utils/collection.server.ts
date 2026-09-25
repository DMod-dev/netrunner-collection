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

export type PrintingWithCounts = Prisma.PrintingGetPayload<{
	select: ReturnType<typeof printingSelect>
}>

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

// ---------------------------------------------------------------------------
// Set completion
// ---------------------------------------------------------------------------

/**
 * - "product": own as many copies of each printing as come in the product.
 *   Only that exact printing counts.
 * - "playset": own a full deck limit of each card in the set. Copies of any
 *   printing count, since a reprint plays the same.
 */
export type CompletionTarget = 'product' | 'playset'

export function parseCompletionTarget(value: string | null): CompletionTarget {
	return value === 'playset' ? 'playset' : 'product'
}

/** Copies a user owns (plain + custom versions) per printing and per card. */
async function getOwnedCounts(userId: string) {
	const select = {
		printingId: true,
		quantity: true,
		printing: { select: { cardId: true } },
	} as const
	const [entries, variants] = await Promise.all([
		prisma.collectionEntry.findMany({ where: { userId }, select }),
		prisma.variant.findMany({
			where: { userId, quantity: { gt: 0 } },
			select,
		}),
	])
	const byPrinting = new Map<string, number>()
	const byCard = new Map<string, number>()
	for (const { printingId, quantity, printing } of [...entries, ...variants]) {
		byPrinting.set(printingId, (byPrinting.get(printingId) ?? 0) + quantity)
		byCard.set(printing.cardId, (byCard.get(printing.cardId) ?? 0) + quantity)
	}
	return { byPrinting, byCard }
}

type OwnedCounts = Awaited<ReturnType<typeof getOwnedCounts>>

function printingProgress(
	printing: { id: string; cardId: string; quantity: number; deckLimit: number },
	owned: OwnedCounts,
	target: CompletionTarget,
) {
	const need = target === 'product' ? printing.quantity : printing.deckLimit
	const count =
		target === 'product'
			? (owned.byPrinting.get(printing.id) ?? 0)
			: (owned.byCard.get(printing.cardId) ?? 0)
	return { owned: count, have: Math.min(count, need), need }
}

export async function getSetsProgress(
	userId: string,
	target: CompletionTarget,
) {
	const [cycles, owned] = await Promise.all([
		prisma.cardCycle.findMany({
			orderBy: { position: 'desc' },
			select: {
				id: true,
				name: true,
				sets: {
					orderBy: { position: 'asc' },
					select: {
						id: true,
						name: true,
						setTypeId: true,
						dateRelease: true,
						printings: {
							select: {
								id: true,
								cardId: true,
								quantity: true,
								card: { select: { deckLimit: true } },
							},
						},
					},
				},
			},
		}),
		getOwnedCounts(userId),
	])

	return cycles.map((cycle) => {
		const sets = cycle.sets.map(({ printings, ...set }) => {
			let have = 0
			let need = 0
			let completeCards = 0
			for (const p of printings) {
				const progress = printingProgress(
					{ ...p, deckLimit: p.card.deckLimit },
					owned,
					target,
				)
				have += progress.have
				need += progress.need
				if (progress.have >= progress.need) completeCards++
			}
			return {
				...set,
				have,
				need,
				cardCount: printings.length,
				completeCards,
			}
		})
		return {
			id: cycle.id,
			name: cycle.name,
			have: sets.reduce((sum, s) => sum + s.have, 0),
			need: sets.reduce((sum, s) => sum + s.need, 0),
			sets,
		}
	})
}

export async function getSetCompletion(
	userId: string,
	setId: string,
	target: CompletionTarget,
) {
	const [set, owned] = await Promise.all([
		prisma.cardSet.findUnique({
			where: { id: setId },
			select: {
				id: true,
				name: true,
				setTypeId: true,
				dateRelease: true,
				cycle: { select: { id: true, name: true } },
				printings: {
					orderBy: { position: 'asc' },
					select: {
						...printingSelect(userId),
						card: {
							select: {
								id: true,
								title: true,
								deckLimit: true,
								faction: { select: { id: true, name: true } },
							},
						},
					},
				},
			},
		}),
		getOwnedCounts(userId),
	])
	if (!set) return null

	const printings = set.printings.map((printing) => ({
		...printing,
		progress: printingProgress(
			{
				id: printing.id,
				cardId: printing.card.id,
				quantity: printing.quantity,
				deckLimit: printing.card.deckLimit,
			},
			owned,
			target,
		),
	}))
	return {
		...set,
		printings,
		have: printings.reduce((sum, p) => sum + p.progress.have, 0),
		need: printings.reduce((sum, p) => sum + p.progress.need, 0),
	}
}
