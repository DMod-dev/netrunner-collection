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
	runner: ['event', 'hardware', 'resource', 'program'],
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
 * in-flight one onto the saved decklist, so they share this prefix.
 */
export function deckCardFetcherKey(deckId: string, cardId: string) {
	return `${deckCardFetcherPrefix(deckId)}${cardId}`
}

export function deckCardFetcherPrefix(deckId: string) {
	return `deck-${deckId}-`
}

/** Fetcher keys for a deck's own settings (not its cards). */
export function deckSettingsFetcherKey(
	deckId: string,
	setting: 'identity' | 'legality' | 'format' | 'name' | 'notes',
) {
	return `deck-settings-${deckId}-${setting}`
}
