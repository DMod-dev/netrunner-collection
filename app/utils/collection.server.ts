import { type Prisma } from '@prisma/client'
import { cachedUntilNextSync } from './card-data-cache.server.ts'
import { MAX_QUANTITY, MINI_FACTIONS, NEUTRAL_FACTIONS } from './collection.ts'
import { prisma } from './db.server.ts'

export const CARDS_PER_PAGE = 30

export type CardSearchParams = {
	q?: string
	/** Cards from any of these sides. */
	sides?: string[]
	/**
	 * Cards from any of these factions. `NEUTRAL_FACTIONS` and `MINI_FACTIONS`
	 * each stand for a group of them.
	 */
	factions?: string[]
	type?: string
	set?: string
	format?: string
	owned?: 'owned' | 'missing'
	page?: number
}

function clampQuantity(quantity: number) {
	return Math.max(0, Math.min(MAX_QUANTITY, Math.trunc(quantity)))
}

function factionWhere(factions: string[]): Prisma.CardWhereInput {
	const ids = factions.filter(
		(f) => f !== NEUTRAL_FACTIONS && f !== MINI_FACTIONS,
	)
	return {
		OR: [
			...(ids.length ? [{ factionId: { in: ids } }] : []),
			...(factions.includes(NEUTRAL_FACTIONS)
				? [{ factionId: { startsWith: 'neutral' } }]
				: []),
			...(factions.includes(MINI_FACTIONS)
				? [{ faction: { isMini: true } }]
				: []),
		],
	}
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

/** Options for reading a collection that may not be the viewer's own. */
type ReadOptions = { includeNotes?: boolean }

export async function searchCards(
	userId: string,
	params: CardSearchParams,
	options: ReadOptions = {},
) {
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
			params.sides?.length ? { sideId: { in: params.sides } } : {},
			params.factions?.length ? factionWhere(params.factions) : {},
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
					select: printingSelect(userId, options),
				},
				preferredArt: { where: { userId }, select: { printingId: true } },
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

/**
 * The fields every printing tile needs, including this user's counts. Pass
 * `includeNotes: false` when showing someone else's collection, so their
 * private notes on custom versions never leave the server.
 */
export function printingSelect(
	userId: string,
	{ includeNotes = true }: { includeNotes?: boolean } = {},
) {
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
			select: { id: true, label: true, quantity: true, notes: includeNotes },
		},
	} satisfies Prisma.PrintingSelect
}

export type PrintingWithCounts = Prisma.PrintingGetPayload<{
	select: ReturnType<typeof printingSelect>
}>

/** Factions, types and sets to filter by. Only a sync changes them. */
export function getFilterOptions() {
	return cachedUntilNextSync('filter-options', getFreshFilterOptions)
}

/** How many cards exist in total. Only a sync changes it. */
export function getCardCount() {
	return cachedUntilNextSync('card-count', () => prisma.card.count())
}

async function getFreshFilterOptions() {
	const [factions, types, cycles] = await Promise.all([
		prisma.faction.findMany({
			orderBy: [{ sideId: 'asc' }, { isMini: 'asc' }, { name: 'asc' }],
			select: { id: true, name: true, sideId: true, isMini: true },
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
	return { factionToggles: getFactionToggles(factions), types, cycles }
}

type FactionToggle = {
	/** The `faction` filter value. */
	value: string
	name: string
	/** What it covers, for its colors and to tell which sides it belongs to. */
	factions: { id: string; name: string; sideId: string }[]
}

/**
 * One toggle per main faction, then one for all the mini-factions and one for
 * both sides' neutrals.
 */
function getFactionToggles(
	factions: { id: string; name: string; sideId: string; isMini: boolean }[],
) {
	const isNeutral = (f: { id: string }) => f.id.startsWith('neutral')
	const toggles: FactionToggle[] = factions
		.filter((f) => !f.isMini && !isNeutral(f))
		.map(({ id, name, sideId }) => ({
			value: id,
			name,
			factions: [{ id, name, sideId }],
		}))
	const groups = [
		{
			value: MINI_FACTIONS,
			name: 'Mini-factions',
			match: (f: { isMini: boolean }) => f.isMini,
		},
		{ value: NEUTRAL_FACTIONS, name: 'Neutral', match: isNeutral },
	]
	for (const { value, name, match } of groups) {
		const members = factions.filter(match)
		if (!members.length) continue
		toggles.push({
			value,
			name,
			factions: members.map(({ id, name, sideId }) => ({ id, name, sideId })),
		})
	}
	return toggles
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

/**
 * Show this printing's art for its card from now on. Returns false if the
 * printing doesn't exist.
 */
export async function setPreferredPrinting(userId: string, printingId: string) {
	const printing = await prisma.printing.findUnique({
		where: { id: printingId },
		select: { cardId: true },
	})
	if (!printing) return false
	const { cardId } = printing
	await prisma.preferredPrinting.upsert({
		where: { userId_cardId: { userId, cardId } },
		create: { userId, cardId, printingId },
		update: { printingId },
	})
	return true
}

/** Go back to picking a card's art automatically. */
export async function clearPreferredPrinting(userId: string, cardId: string) {
	await prisma.preferredPrinting.deleteMany({ where: { userId, cardId } })
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
	options: ReadOptions = {},
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
						...printingSelect(userId, options),
						card: {
							select: {
								id: true,
								title: true,
								deckLimit: true,
								displaySubtypes: true,
								faction: { select: { id: true, name: true } },
								type: { select: { name: true } },
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

// ---------------------------------------------------------------------------
// Bulk entry
// ---------------------------------------------------------------------------

/**
 * Add (or with a negative `copies`, remove) whole products: each printing in
 * the set changes by `copies` × the number that come in the product. Only
 * plain copies change; custom versions are left alone.
 */
export async function addProductCopies(
	userId: string,
	setId: string,
	copies: number,
) {
	const printings = await prisma.printing.findMany({
		where: { setId },
		select: {
			id: true,
			quantity: true,
			collectionEntries: { where: { userId }, select: { quantity: true } },
		},
	})
	if (!printings.length) return null

	let changed = 0
	const writes: Array<Prisma.PrismaPromise<unknown>> = []
	for (const printing of printings) {
		const current = printing.collectionEntries[0]?.quantity ?? 0
		const next = clampQuantity(current + printing.quantity * copies)
		if (next === current) continue
		changed += next - current
		writes.push(
			next === 0
				? prisma.collectionEntry.delete({
						where: { userId_printingId: { userId, printingId: printing.id } },
					})
				: prisma.collectionEntry.upsert({
						where: { userId_printingId: { userId, printingId: printing.id } },
						create: { userId, printingId: printing.id, quantity: next },
						update: { quantity: next },
					}),
		)
	}
	await prisma.$transaction(writes)
	return { changed }
}

/** How many distinct cards a user owns, and how many copies in all. */
export async function getCollectionTotals(userId: string) {
	const [entries, variants, ownedCards] = await Promise.all([
		prisma.collectionEntry.aggregate({
			where: { userId },
			_sum: { quantity: true },
		}),
		prisma.variant.aggregate({
			where: { userId },
			_sum: { quantity: true },
		}),
		prisma.card.count({
			where: {
				printings: {
					some: {
						OR: [
							{ collectionEntries: { some: { userId, quantity: { gt: 0 } } } },
							{ variants: { some: { userId, quantity: { gt: 0 } } } },
						],
					},
				},
			},
		}),
	])
	return {
		copies: (entries._sum.quantity ?? 0) + (variants._sum.quantity ?? 0),
		ownedCards,
	}
}
