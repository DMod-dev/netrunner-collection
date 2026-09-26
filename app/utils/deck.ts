// Deck constants and helpers shared by server code and client components.
import { DECK_FORMATS, type DeckFormat } from './deck-formats.ts'

/** Most copies of one card a deck can hold. Over the deck limit is an error, not a block. */
export const MAX_DECK_QUANTITY = 9

export const MAX_DECK_NAME_LENGTH = 100
export const MAX_DECK_NOTES_LENGTH = 5000

export const DECK_SIDES = ['corp', 'runner'] as const
export type DeckSide = (typeof DECK_SIDES)[number]

export const IDENTITY_TYPES: Record<DeckSide, string> = {
	corp: 'corp_identity',
	runner: 'runner_identity',
}

/** The card types a deck can hold, in the order the decklist shows them. */
export const DECK_CARD_TYPES: Record<DeckSide, string[]> = {
	corp: ['agenda', 'asset', 'upgrade', 'operation', 'ice'],
	runner: ['event', 'resource', 'program', 'hardware'],
}

export function parseDeckSide(value: string): DeckSide {
	return value === 'runner' ? 'runner' : 'corp'
}

/** A stored format id, falling back to Standard for one we no longer offer. */
export function parseDeckFormat(value: string): DeckFormat {
	return DECK_FORMATS.find((f) => f === value) ?? 'standard'
}

/**
 * The fetcher key of a card's deck stepper. The builder overlays every
 * in-flight one (and every "from collection" one) onto the saved decklist,
 * so they share this prefix.
 */
export function deckCardFetcherKey(deckId: string, cardId: string) {
	return `${deckCardFetcherPrefix(deckId)}${cardId}`
}

/** The fetcher key of a card's "from collection" stepper. */
export function deckCollectionFetcherKey(deckId: string, cardId: string) {
	return `${deckCardFetcherPrefix(deckId)}collection:${cardId}`
}

export function deckCardFetcherPrefix(deckId: string) {
	return `deck-${deckId}-`
}

/** Fetcher keys for a deck's own settings (not its cards). */
export function deckSettingsFetcherKey(
	deckId: string,
	setting:
		| 'identity'
		| 'legality'
		| 'format'
		| 'name'
		| 'notes'
		| 'fill'
		| 'import'
		| 'remove-illegal',
) {
	return `deck-settings-${deckId}-${setting}`
}

/** The decklist grouped by type, in the order players expect for the side. */
export function groupByType<
	Entry extends {
		card: { typeId: string; typeName: string; title: string }
		quantity: number
	},
>(entries: Entry[], side: DeckSide) {
	const order = DECK_CARD_TYPES[side]
	const groups = new Map<string, { name: string; entries: Entry[] }>()
	for (const entry of entries) {
		const { typeId, typeName } = entry.card
		const group = groups.get(typeId)
		if (group) group.entries.push(entry)
		else groups.set(typeId, { name: typeName, entries: [entry] })
	}
	const rank = (typeId: string) => {
		const i = order.indexOf(typeId)
		return i === -1 ? order.length : i
	}
	return [...groups.entries()]
		.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
		.map(([typeId, group]) => ({
			typeId,
			name: group.name,
			count: group.entries.reduce((n, e) => n + e.quantity, 0),
			entries: [...group.entries].sort((a, b) =>
				a.card.title.localeCompare(b.card.title),
			),
		}))
}
