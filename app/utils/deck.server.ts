import { invariantResponse } from '@epic-web/invariant'
import { type Prisma } from '@prisma/client'
import { cachedUntilNextSync } from './card-data-cache.server.ts'
import { prisma } from './db.server.ts'
import { DECK_FORMATS, type DeckFormat } from './deck-formats.ts'
import {
	CARD_LITE_SELECT,
	getFormatRules,
	toCardLite,
} from './deck-rules.server.ts'
import {
	evaluateDeck,
	formatIssue,
	isIdentity,
	toBanList,
} from './deck-rules.ts'
import {
	IDENTITY_TYPES,
	MAX_DECK_NAME_LENGTH,
	MAX_DECK_QUANTITY,
	type DeckSide,
	parseDeckFormat,
} from './deck.ts'

// Anyone (signed in or not) can see a public deck; only its owner can see a
// private one. Every loader goes through `requireDeck`, and every write is
// scoped to the owner, so no one else can change either.

export function canViewDeck(
	deck: { userId: string; isPublic: boolean },
	userId: string | null,
) {
	return deck.isPublic || deck.userId === userId
}

/**
 * A deck `userId` (null when signed out) may see, or a 404 whether it doesn't
 * exist or is someone else's private deck.
 */
export async function requireDeck<Select extends Prisma.DeckSelect>(
	userId: string | null,
	deckId: string,
	{ select }: { select: Select },
) {
	// Prisma can't infer a spread generic select; this is what it returns
	const deck = (await prisma.deck.findUnique({
		where: { id: deckId },
		select: { ...select, userId: true, isPublic: true },
	})) as
		| (Prisma.DeckGetPayload<{ select: Select }> & {
				userId: string
				isPublic: boolean
		  })
		| null
	invariantResponse(deck && canViewDeck(deck, userId), 'Deck not found', {
		status: 404,
	})
	return deck
}

/** The deck, if `userId` owns it. Writes check this before changing anything. */
function findOwnDeck(userId: string, deckId: string) {
	return prisma.deck.findFirst({
		where: { id: deckId, userId },
		select: {
			id: true,
			sideId: true,
			identityCardId: true,
			_count: { select: { cards: true } },
		},
	})
}

/** Why a write was refused, for the action to report. */
export type DeckWriteError = { error: string; status: 400 | 404 }

const DECK_NOT_FOUND: DeckWriteError = { error: 'Deck not found', status: 404 }

/** A card's newest printing, whose art stands for it in decks. */
const latestImageSelect = {
	where: { isLatest: true },
	take: 1,
	select: { imageSmall: true, imageLarge: true },
} satisfies Prisma.Card$printingsArgs

function imageOf(card: {
	printings: { imageSmall: string | null; imageLarge: string | null }[]
}) {
	const printing = card.printings[0]
	return printing?.imageLarge ?? printing?.imageSmall ?? null
}

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

/**
 * Every identity on a side, for the identity pickers, with what the rules
 * need so the builder can preview a change. Only a sync changes it.
 */
export function getIdentities(side: DeckSide) {
	return cachedUntilNextSync(`identities:${side}`, async () => {
		const cards = await prisma.card.findMany({
			where: { typeId: IDENTITY_TYPES[side] },
			orderBy: [{ factionId: 'asc' }, { title: 'asc' }],
			select: {
				...CARD_LITE_SELECT,
				faction: { select: { name: true } },
				printings: latestImageSelect,
			},
		})
		return cards.map(({ faction, printings, ...card }) => ({
			...toCardLite(card),
			factionName: faction.name,
			imageUrl: imageOf({ printings }),
		}))
	})
}

export type IdentityOption = Awaited<ReturnType<typeof getIdentities>>[number]

/** The factions that have identities, for the decklist search. */
export function getIdentityFactions() {
	return cachedUntilNextSync('identity-factions', () =>
		prisma.faction.findMany({
			where: {
				cards: { some: { typeId: { in: Object.values(IDENTITY_TYPES) } } },
			},
			orderBy: [{ sideId: 'asc' }, { name: 'asc' }],
			select: { id: true, name: true, sideId: true },
		}),
	)
}

// ---------------------------------------------------------------------------
// Reading decks
// ---------------------------------------------------------------------------

/** The rules for every format a deck can use, for evaluating several decks. */
async function getAllFormatRules() {
	const entries = await Promise.all(
		DECK_FORMATS.map(async (id) => [id, await getFormatRules(id)] as const),
	)
	return new Map(entries)
}

const deckSummarySelect = {
	id: true,
	name: true,
	sideId: true,
	formatId: true,
	requireLegality: true,
	isPublic: true,
	updatedAt: true,
	identityFromCollection: true,
	identity: {
		select: {
			...CARD_LITE_SELECT,
			faction: { select: { name: true } },
			printings: latestImageSelect,
		},
	},
	cards: {
		select: {
			quantity: true,
			fromCollection: true,
			card: { select: CARD_LITE_SELECT },
		},
	},
} satisfies Prisma.DeckSelect

/** A deck's card for the deck lists: its identity, size and legality. */
function summarizeDeck(
	deck: Prisma.DeckGetPayload<{ select: typeof deckSummarySelect }>,
	rules: Awaited<ReturnType<typeof getAllFormatRules>>,
) {
	const formatId = parseDeckFormat(deck.formatId)
	const { stats, problems, isLegal } = evaluateDeck({
		identity: deck.identity ? toCardLite(deck.identity) : null,
		cards: deck.cards.map(({ card, quantity }) => ({
			card: toCardLite(card),
			quantity,
		})),
		formatId,
		requireLegality: deck.requireLegality,
		rules: rules.get(formatId) ?? null,
	})
	return {
		id: deck.id,
		name: deck.name,
		sideId: deck.sideId as DeckSide,
		formatId,
		requireLegality: deck.requireLegality,
		isPublic: deck.isPublic,
		updatedAt: deck.updatedAt,
		identity: deck.identity
			? {
					id: deck.identity.id,
					title: deck.identity.title,
					factionId: deck.identity.factionId,
					factionName: deck.identity.faction.name,
					imageUrl: imageOf(deck.identity),
				}
			: null,
		cardCount: stats.cardCount,
		minDeckSize: stats.minDeckSize,
		isLegal,
		errorCount: problems.filter((p) => p.severity === 'error').length,
		warningCount: problems.filter((p) => p.severity === 'warning').length,
	}
}

/** A user's decks, most recently changed first, with their stats. */
export async function listDecks(userId: string) {
	const [decks, rules] = await Promise.all([
		prisma.deck.findMany({
			where: { userId },
			orderBy: { updatedAt: 'desc' },
			select: deckSummarySelect,
		}),
		getAllFormatRules(),
	])
	return decks.map((deck) => ({
		...summarizeDeck(deck, rules),
		...collectionSummary(deck),
	}))
}

export type DeckSummary = Awaited<ReturnType<typeof listDecks>>[number]

export const PUBLIC_DECKS_PER_PAGE = 24

export type PublicDeckSearch = {
	/**
	 * Words that must each match the deck's name, its identity, its owner or
	 * one of its cards.
	 */
	q?: string
	side?: DeckSide
	/** the identity's faction */
	factionId?: string
	formatId?: DeckFormat
	/** only this user's decks, by username */
	author?: string
	page?: number
}

/** Up to this many words of a search count; the rest are ignored. */
const MAX_SEARCH_WORDS = 8

/**
 * Everyone's public decks that match a search, most recently changed first,
 * with their stats and owners. What owners hold in their collections stays
 * out of it.
 */
export async function searchPublicDecks({
	q,
	side,
	factionId,
	formatId,
	author,
	page = 1,
}: PublicDeckSearch) {
	const words = (q ?? '')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, MAX_SEARCH_WORDS)
	const where = {
		isPublic: true,
		...(side ? { sideId: side } : {}),
		...(formatId ? { formatId } : {}),
		...(factionId ? { identity: { factionId } } : {}),
		...(author ? { user: { username: author } } : {}),
		AND: words.map((word) => {
			const title = [
				{ title: { contains: word } },
				// "Cafe" finds "Café"
				{ strippedTitle: { contains: word } },
			]
			return {
				OR: [
					{ name: { contains: word } },
					{ identity: { OR: title } },
					{ user: { username: { contains: word } } },
					{ user: { name: { contains: word } } },
					{ cards: { some: { card: { OR: title } } } },
				],
			}
		}),
	} satisfies Prisma.DeckWhereInput

	const total = await prisma.deck.count({ where })
	const pageCount = Math.max(1, Math.ceil(total / PUBLIC_DECKS_PER_PAGE))
	const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount)
	const [decks, rules] = await Promise.all([
		prisma.deck.findMany({
			where,
			orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
			skip: (current - 1) * PUBLIC_DECKS_PER_PAGE,
			take: PUBLIC_DECKS_PER_PAGE,
			select: {
				...deckSummarySelect,
				user: { select: { username: true, name: true } },
			},
		}),
		getAllFormatRules(),
	])
	return {
		total,
		page: current,
		pageCount,
		decks: decks.map((deck) => ({
			...summarizeDeck(deck, rules),
			owner: deck.user,
		})),
	}
}

export type PublicDeckSummary = Awaited<
	ReturnType<typeof searchPublicDecks>
>['decks'][number]

/**
 * How much of a deck comes from the collection: whether it's filled at all,
 * how many copies, and whether any card (or the identity) is short.
 */
function collectionSummary(deck: {
	identity: unknown
	identityFromCollection: number
	cards: Array<{ quantity: number; fromCollection: number }>
}) {
	const copiesFromCollection =
		deck.identityFromCollection +
		deck.cards.reduce((sum, c) => sum + c.fromCollection, 0)
	const filledFromCollection = copiesFromCollection > 0
	return {
		filledFromCollection,
		copiesFromCollection,
		shortFromCollection:
			filledFromCollection &&
			(deck.cards.some((c) => c.fromCollection < c.quantity) ||
				(deck.identity !== null && deck.identityFromCollection < 1)),
	}
}

/**
 * Everything the builder shows about a deck (not the card browser), for its
 * owner or, if it's public, anyone else (`userId` null when signed out). Only
 * the owner is told what's reserved from their collection.
 */
export async function getDeckForBuilder(userId: string | null, deckId: string) {
	const deck = await requireDeck(userId, deckId, {
		select: {
			id: true,
			name: true,
			user: { select: { username: true, name: true } },
			sideId: true,
			formatId: true,
			requireLegality: true,
			notes: true,
			nrdbUrl: true,
			updatedAt: true,
			identityFromCollection: true,
			identity: {
				select: {
					...CARD_LITE_SELECT,
					faction: { select: { name: true } },
					printings: latestImageSelect,
				},
			},
			cards: {
				orderBy: { card: { title: 'asc' } },
				select: {
					quantity: true,
					fromCollection: true,
					card: {
						select: {
							...CARD_LITE_SELECT,
							type: { select: { name: true } },
							printings: latestImageSelect,
						},
					},
				},
			},
		},
	})
	const formatId = parseDeckFormat(deck.formatId)
	const { identity } = deck
	const isOwner = deck.userId === userId
	return {
		id: deck.id,
		name: deck.name,
		sideId: deck.sideId as DeckSide,
		formatId,
		requireLegality: deck.requireLegality,
		isPublic: deck.isPublic,
		isOwner,
		owner: deck.user,
		notes: deck.notes,
		nrdbUrl: deck.nrdbUrl,
		updatedAt: deck.updatedAt,
		identityFromCollection: isOwner ? deck.identityFromCollection : 0,
		identity: identity
			? {
					...toCardLite(identity),
					factionName: identity.faction.name,
					imageUrl: imageOf(identity),
				}
			: null,
		cards: deck.cards.map(({ card, quantity, fromCollection }) => ({
			quantity,
			fromCollection: isOwner ? fromCollection : 0,
			card: {
				...toCardLite(card),
				typeName: card.type.name,
				imageUrl: imageOf(card),
			},
		})),
		rules: await getFormatRules(formatId),
	}
}

export type BuilderDeck = Awaited<ReturnType<typeof getDeckForBuilder>>

// ---------------------------------------------------------------------------
// Writing decks
// ---------------------------------------------------------------------------

/**
 * A new, empty deck for an identity. Returns null if the identity isn't one.
 * With no name it's named after the identity. Its format isn't checked until
 * the user turns on "Require deck legality".
 */
export async function createDeck(
	userId: string,
	{
		identityCardId,
		formatId,
		name,
	}: { identityCardId: string; formatId: DeckFormat; name?: string },
) {
	const identity = await prisma.card.findUnique({
		where: { id: identityCardId },
		select: { title: true, sideId: true, typeId: true },
	})
	if (!identity || !isIdentity(identity)) return null
	return prisma.deck.create({
		data: {
			userId,
			name: name?.trim() || identity.title,
			sideId: identity.sideId,
			formatId,
			requireLegality: false,
			identityCardId,
		},
		select: { id: true },
	})
}

/**
 * Set how many copies of a card the deck has; 0 takes it out. Copies reserved
 * from the collection never exceed the new count. Adding cards from the other
 * side, or identities (a deck's identity is set on its own), is refused;
 * taking them out isn't.
 */
export async function setDeckCardQuantity(
	userId: string,
	deckId: string,
	cardId: string,
	quantity: number,
): Promise<DeckWriteError | { quantity: number }> {
	const clamped = Math.max(0, Math.min(MAX_DECK_QUANTITY, Math.trunc(quantity)))
	const deck = await findOwnDeck(userId, deckId)
	if (!deck) return DECK_NOT_FOUND
	const card = await prisma.card.findUnique({
		where: { id: cardId },
		select: { title: true, sideId: true, typeId: true },
	})
	if (!card) return { error: 'Card not found', status: 404 }
	const key = { deckId_cardId: { deckId, cardId } }
	const misfit = isIdentity(card)
		? `${card.title} is an identity; change the deck’s identity instead`
		: card.sideId !== deck.sideId
			? `${card.title} is a ${card.sideId} card; this is a ${deck.sideId} deck`
			: null
	if (misfit) {
		// an import can bring them in; they can only be taken out
		const row = await prisma.deckCard.findUnique({
			where: key,
			select: { quantity: true },
		})
		if (clamped > (row?.quantity ?? 0)) return { error: misfit, status: 400 }
	}

	await prisma.$transaction(async (tx) => {
		if (clamped === 0) {
			await tx.deckCard.deleteMany({ where: { deckId, cardId } })
		} else {
			const existing = await tx.deckCard.findUnique({
				where: key,
				select: { fromCollection: true },
			})
			await tx.deckCard.upsert({
				where: key,
				create: { deckId, cardId, quantity: clamped },
				update: {
					quantity: clamped,
					fromCollection: Math.min(existing?.fromCollection ?? 0, clamped),
				},
			})
		}
		await touchDeck(tx, deckId)
	})
	return { quantity: clamped }
}

/**
 * Change the deck's identity. Switching sides would strand every card, so
 * it's only allowed while the deck is empty. A new identity isn't reserved
 * from the collection until the deck is filled again.
 */
export async function setDeckIdentity(
	userId: string,
	deckId: string,
	identityCardId: string,
): Promise<DeckWriteError | { ok: true }> {
	const deck = await findOwnDeck(userId, deckId)
	if (!deck) return DECK_NOT_FOUND
	const identity = await prisma.card.findUnique({
		where: { id: identityCardId },
		select: { title: true, sideId: true, typeId: true },
	})
	if (!identity || !isIdentity(identity)) {
		return { error: 'Identity not found', status: 404 }
	}
	if (identity.sideId !== deck.sideId && deck._count.cards > 0) {
		return {
			error: `${identity.title} is a ${identity.sideId} identity; empty the deck before switching sides`,
			status: 400,
		}
	}
	await prisma.deck.update({
		where: { id: deckId },
		data: {
			identityCardId,
			sideId: identity.sideId,
			// the old identity's copy goes back to the collection
			...(identityCardId === deck.identityCardId
				? {}
				: { identityFromCollection: 0 }),
		},
	})
	return { ok: true }
}

/**
 * Change a deck's name, notes, format, whether it must be legal or whether
 * it's public. Returns false if the user doesn't own the deck.
 */
export async function updateDeck(
	userId: string,
	deckId: string,
	data: {
		name?: string
		notes?: string | null
		formatId?: DeckFormat
		requireLegality?: boolean
		isPublic?: boolean
	},
) {
	const { count } = await prisma.deck.updateMany({
		where: { id: deckId, userId },
		data,
	})
	return count > 0
}

/**
 * Take every card the deck's format doesn't allow (outside its card pool,
 * banned, or of a banned subtype) out of the deck; their reserved copies go
 * back to the collection. The identity stays. Returns how many copies went,
 * or null if the user doesn't own the deck.
 */
export async function removeIllegalCards(userId: string, deckId: string) {
	const deck = await prisma.deck.findFirst({
		where: { id: deckId, userId },
		select: {
			formatId: true,
			cards: {
				select: {
					quantity: true,
					card: { select: CARD_LITE_SELECT },
				},
			},
		},
	})
	if (!deck) return null
	const formatId = parseDeckFormat(deck.formatId)
	const banList = toBanList(await getFormatRules(formatId))
	const illegal = deck.cards.filter(({ card }) =>
		formatIssue(toCardLite(card), formatId, banList),
	)
	if (illegal.length === 0) return { removed: 0, formatId }
	await prisma.$transaction(async (tx) => {
		await tx.deckCard.deleteMany({
			where: { deckId, cardId: { in: illegal.map(({ card }) => card.id) } },
		})
		await touchDeck(tx, deckId)
	})
	return {
		removed: illegal.reduce((n, { quantity }) => n + quantity, 0),
		formatId,
	}
}

/**
 * A new deck for `userId` with the same identity, format, cards and notes as
 * one they can see (theirs, or anyone's public deck). The copy is theirs to
 * change; nothing is reserved from their collection until they fill it.
 * Returns null if they can't see the deck.
 */
export async function copyDeck(userId: string, deckId: string) {
	const deck = await prisma.deck.findUnique({
		where: { id: deckId },
		select: {
			userId: true,
			isPublic: true,
			name: true,
			sideId: true,
			formatId: true,
			requireLegality: true,
			notes: true,
			identityCardId: true,
			cards: { select: { cardId: true, quantity: true } },
		},
	})
	if (!deck || !canViewDeck(deck, userId)) return null
	return prisma.deck.create({
		data: {
			userId,
			name: copyName(deck.name),
			sideId: deck.sideId,
			formatId: deck.formatId,
			requireLegality: deck.requireLegality,
			notes: deck.notes,
			identityCardId: deck.identityCardId,
			cards: { create: deck.cards },
		},
		select: { id: true, name: true },
	})
}

/** "Name (copy)", cut short if it would be too long. */
export function copyName(name: string) {
	const suffix = ' (copy)'
	return `${name.slice(0, MAX_DECK_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`
}

export async function deleteDeck(userId: string, deckId: string) {
	const { count } = await prisma.deck.deleteMany({
		where: { id: deckId, userId },
	})
	return count > 0
}

/** Bump `updatedAt` when only the deck's cards changed, so it sorts first. */
function touchDeck(tx: Prisma.TransactionClient, deckId: string) {
	return tx.deck.update({
		where: { id: deckId },
		data: { updatedAt: new Date() },
		select: { id: true },
	})
}
