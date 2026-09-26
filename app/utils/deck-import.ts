// Deck import constants shared by the forms that take a pasted deck.

/** Longest decklist (or link) a form accepts; the rest is cut off. */
export const MAX_DECK_INPUT_LENGTH = 20_000

export const DECK_INPUT_PLACEHOLDER = `Paste a NetrunnerDB deck link, e.g.
https://netrunnerdb.com/en/decklist/…

or a decklist, one card per line:
René "Loup" Arcemont: Party Animal
3x Wildcat Strike
2 Carnivore
Mayday x1`

/** Most unmatched lines an import's toast lists, to keep its cookie small. */
export const MAX_UNRECOGNIZED_SHOWN = 10
