import { importScryfallCards } from '#app/utils/scryfall.server.ts'
import { MTG_CARDS, MTG_SETS } from './fixtures/mtg.ts'

/**
 * Seed the MTG card tables with the real cards in tests/fixtures/mtg.ts,
 * through the Scryfall sync's own mapping.
 */
export async function insertMtgCards() {
	return importScryfallCards(MTG_CARDS, MTG_SETS)
}
