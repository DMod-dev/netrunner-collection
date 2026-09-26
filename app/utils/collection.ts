// Collection constants shared by server code and client components.

export const MAX_QUANTITY = 99

/** Most whole products that can be added or removed in one go. */
export const MAX_PRODUCT_COPIES = 10

/**
 * Faction filter values that stand for several factions: both sides'
 * neutrals, and every mini-faction (Adam, Apex, Sunny Lebeau).
 */
export const NEUTRAL_FACTIONS = 'neutral'
export const MINI_FACTIONS = 'mini'

type ArtCandidate = {
	id: string
	collectionEntries: { quantity: number }[]
	variants: { quantity: number }[]
}

/**
 * The printing whose art stands for a card: the one the user picked, else the
 * newest one they own a copy of, else the newest. `printings` must be newest
 * first.
 */
export function pickArtPrinting<Printing extends ArtCandidate>(
	printings: Printing[],
	preferredId?: string | null,
) {
	const owns = (p: Printing) =>
		(p.collectionEntries[0]?.quantity ?? 0) +
			p.variants.reduce((sum, v) => sum + v.quantity, 0) >
		0
	return (
		printings.find((p) => p.id === preferredId) ??
		printings.find(owns) ??
		printings[0]
	)
}
