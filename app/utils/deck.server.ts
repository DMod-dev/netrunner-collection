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
import { evaluateDeck, isIdentity } from './deck-rules.ts'
import {
	IDENTITY_TYPES,
	MAX_DECK_QUANTITY,
	type DeckSide,
	parseDeckFormat,
} from './deck.ts'

// Decks are private to their owner for now. Every loader goes through
// `requireDeck`, and every write is scoped to the owner, so making decks
// public later only needs a new branch in `canViewDeck`.

export function canViewDeck(deck: { userId: string }, userId: string | null) {
	return deck.userId === userId
}

/** A deck `userId` may see, or a 404 (whether it doesn't exist or isn't theirs). */
export async function requireDeck<Select extends Prisma.DeckSelect>(
	userId: string,
	deckId: string,
	{ select }: { select: Select },
) {
	// Prisma can't infer a spread generic select; this is what it returns
	const deck = (await prisma.deck.findUnique({
		where: { id: deckId },
		select: { ...select, userId: true },
	})) as (Prisma.DeckGetPayload<{ select: Select }> & { userId: string }) | null
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

/** A user's decks, most recently changed first, with their stats. */
export async function listDecks(userId: string) {
	const [decks, rules] = await Promise.all([
		prisma.deck.findMany({
			where: { userId },
			orderBy: { updatedAt: 'desc' },
			select: {
				id: true,
				name: true,
				sideId: true,
				formatId: true,
				requireLegality: true,
				updatedAt: true,
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
			},
		}),
		getAllFormatRules(),
	])

	return decks.map((deck) => {
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
			sideId: deck.sideId,
			formatId,
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
			filledFromCollection: deck.cards.some((c) => c.fromCollection > 0),
		}
	})
}

export type DeckSummary = Awaited<ReturnType<typeof listDecks>>[number]

/** Everything the builder shows about a deck (not the card browser). */
export async function getDeckForBuilder(userId: string, deckId: string) {
	const deck = await requireDeck(userId, deckId, {
		select: {
			id: true,
			name: true,
			sideId: true,
			formatId: true,
			requireLegality: true,
			notes: true,
			nrdbUrl: true,
			updatedAt: true,
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
	return {
		id: deck.id,
		name: deck.name,
		sideId: deck.sideId as DeckSide,
		formatId,
		requireLegality: deck.requireLegality,
		notes: deck.notes,
		nrdbUrl: deck.nrdbUrl,
		updatedAt: deck.updatedAt,
		identity: identity
			? {
					...toCardLite(identity),
					factionName: identity.faction.name,
					imageUrl: imageOf(identity),
				}
			: null,
		cards: deck.cards.map(({ card, quantity, fromCollection }) => ({
			quantity,
			fromCollection,
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
 * With no name it's named after the identity.
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
			identityCardId,
		},
		select: { id: true },
	})
}

/**
 * Set how many copies of a card the deck has; 0 takes it out. Copies reserved
 * from the collection never exceed the new count. Cards from the other side,
 * and identities (a deck's identity is set on its own), are refused.
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
	if (isIdentity(card)) {
		return {
			error: `${card.title} is an identity; change the deck’s identity instead`,
			status: 400,
		}
	}
	if (card.sideId !== deck.sideId) {
		return {
			error: `${card.title} is a ${card.sideId} card; this is a ${deck.sideId} deck`,
			status: 400,
		}
	}

	const key = { deckId_cardId: { deckId, cardId } }
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
 * it's only allowed while the deck is empty.
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
		data: { identityCardId, sideId: identity.sideId },
	})
	return { ok: true }
}

/**
 * Change a deck's name, notes, format or whether it must be legal. Returns
 * false if the user doesn't own the deck.
 */
export async function updateDeck(
	userId: string,
	deckId: string,
	data: {
		name?: string
		notes?: string | null
		formatId?: DeckFormat
		requireLegality?: boolean
	},
) {
	const { count } = await prisma.deck.updateMany({
		where: { id: deckId, userId },
		data,
	})
	return count > 0
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
