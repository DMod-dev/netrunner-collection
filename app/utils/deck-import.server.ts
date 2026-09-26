import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'
import {
	DeckImportError,
	type DeckRequirements,
	fetchNrdbDeck,
	parseDeckText,
	parseNrdbDeckRef,
} from './deck-check.server.ts'
import { type DeckFormat } from './deck-formats.ts'
import { MAX_DECK_INPUT_LENGTH } from './deck-import.ts'
import { isIdentity } from './deck-rules.ts'
import { MAX_DECK_NAME_LENGTH, MAX_DECK_QUANTITY } from './deck.ts'

/**
 * What a pasted NetrunnerDB link or decklist asks for. Throws a
 * DeckImportError, with a message for the user, for a bad link, NetrunnerDB
 * being down, or input with no cards in it.
 */
export async function readDeckInput(input: string): Promise<DeckRequirements> {
	const text = input.slice(0, MAX_DECK_INPUT_LENGTH)
	if (!text.trim()) {
		throw new DeckImportError('Paste a decklist or NetrunnerDB link first.')
	}
	const ref = parseNrdbDeckRef(text)
	const requirements = ref
		? await fetchNrdbDeck(ref)
		: await parseDeckText(text)
	if (requirements.cards.size === 0) {
		throw new DeckImportError(
			'Couldn’t find any cards in that. Use one card per line, like "3x Hedge Fund".',
		)
	}
	return requirements
}

type DeckPlan = {
	identityCardId: string | null
	identityTitle: string | null
	sideId: string
	cards: Array<{ cardId: string; quantity: number }>
	unrecognized: string[]
}

/**
 * Turn requirements into a deck's rows. The first identity becomes the
 * deck's identity; any others stay as cards, like cards from the other side,
 * so the rules engine flags them. The side is the identity's, or else the
 * one most of the cards are on.
 */
async function planDeck(
	requirements: DeckRequirements,
	db: Prisma.TransactionClient,
): Promise<DeckPlan> {
	const found = await db.card.findMany({
		where: { id: { in: [...requirements.cards.keys()] } },
		select: { id: true, title: true, sideId: true, typeId: true },
	})
	const byId = new Map(found.map((card) => [card.id, card]))
	const unrecognized = [...requirements.unrecognized]
	let identity: (typeof found)[number] | null = null
	const cards: DeckPlan['cards'] = []
	const copiesBySide = new Map<string, number>()
	for (const [cardId, count] of requirements.cards) {
		const card = byId.get(cardId)
		// a NetrunnerDB decklist can have cards newer than our last sync
		if (!card) {
			unrecognized.push(`${count}x card ${cardId}`)
			continue
		}
		// extra copies of the identity (a deck named after it) are dropped
		if (isIdentity(card) && !identity) {
			identity = card
			continue
		}
		cards.push({
			cardId,
			quantity: Math.max(1, Math.min(MAX_DECK_QUANTITY, count)),
		})
		copiesBySide.set(card.sideId, (copiesBySide.get(card.sideId) ?? 0) + count)
	}
	if (!identity && cards.length === 0) {
		throw new DeckImportError(
			'None of those cards are in the card list yet. Try again after the next NetrunnerDB sync.',
		)
	}
	const majority = [...copiesBySide].sort(([, a], [, b]) => b - a)[0]?.[0]
	return {
		identityCardId: identity?.id ?? null,
		identityTitle: identity?.title ?? null,
		sideId: identity?.sideId ?? majority ?? 'corp',
		cards,
		unrecognized,
	}
}

/**
 * Create a deck from a pasted NetrunnerDB link or decklist. It isn't filled
 * from the collection; the caller does that. Throws a DeckImportError the
 * form shows as it is.
 */
export async function importDeck(
	userId: string,
	input: string,
	{
		formatId,
		requireLegality,
		name,
	}: { formatId: DeckFormat; requireLegality: boolean; name?: string },
): Promise<{ deckId: string; unrecognized: string[] }> {
	const requirements = await readDeckInput(input)
	const plan = await planDeck(requirements, prisma)
	const deck = await prisma.deck.create({
		data: {
			userId,
			name: (
				name?.trim() ||
				requirements.name?.trim() ||
				plan.identityTitle ||
				'Imported deck'
			).slice(0, MAX_DECK_NAME_LENGTH),
			sideId: plan.sideId,
			formatId,
			requireLegality,
			nrdbUrl: requirements.nrdbUrl,
			identityCardId: plan.identityCardId,
			cards: { create: plan.cards },
		},
		select: { id: true },
	})
	return { deckId: deck.id, unrecognized: plan.unrecognized }
}

/**
 * Replace a deck's cards with an imported list. The deck keeps its name and
 * settings, and its identity when the list has none of its own (and is for
 * the same side). Rows whose count didn't change keep what they reserved
 * from the collection; the rest keep at most their new count. Returns null
 * if the user doesn't own the deck.
 */
export async function replaceDeckCards(
	userId: string,
	deckId: string,
	requirements: DeckRequirements,
) {
	return prisma.$transaction(async (tx) => {
		const deck = await tx.deck.findFirst({
			where: { id: deckId, userId },
			select: {
				identityCardId: true,
				identityFromCollection: true,
				identity: { select: { sideId: true } },
				cards: {
					select: { cardId: true, quantity: true, fromCollection: true },
				},
			},
		})
		if (!deck) return null
		const plan = await planDeck(requirements, tx)
		const identityCardId =
			plan.identityCardId ??
			(deck.identity?.sideId === plan.sideId ? deck.identityCardId : null)

		const before = new Map(deck.cards.map((row) => [row.cardId, row]))
		await tx.deckCard.deleteMany({
			where: { deckId, cardId: { notIn: plan.cards.map((c) => c.cardId) } },
		})
		for (const { cardId, quantity } of plan.cards) {
			const row = before.get(cardId)
			if (!row) {
				await tx.deckCard.create({ data: { deckId, cardId, quantity } })
				continue
			}
			if (row.quantity === quantity) continue
			await tx.deckCard.update({
				where: { deckId_cardId: { deckId, cardId } },
				data: {
					quantity,
					fromCollection: Math.min(row.fromCollection, quantity),
				},
			})
		}
		await tx.deck.update({
			where: { id: deckId },
			data: {
				identityCardId,
				sideId: plan.sideId,
				nrdbUrl: requirements.nrdbUrl,
				identityFromCollection:
					identityCardId === deck.identityCardId
						? deck.identityFromCollection
						: 0,
				updatedAt: new Date(),
			},
		})
		const wasFilled =
			deck.identityFromCollection > 0 ||
			deck.cards.some((row) => row.fromCollection > 0)
		return { unrecognized: plan.unrecognized, wasFilled }
	})
}
