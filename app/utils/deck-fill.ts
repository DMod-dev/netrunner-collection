// "Fill with collection": which of a deck's copies come from the owner's
// collection. Client-safe; the reads and writes are in deck-fill.server.ts.

/** A deck holding copies of a card, and how many. */
export type Reservation = { deckId: string; name: string; quantity: number }

/** How many copies of a card the user has, and how many other decks hold. */
export type Availability = {
	/** every printing and custom version */
	owned: number
	/** held by the user's other filled decks */
	reservedElsewhere: number
	reservedBy: Reservation[]
	/** what's left for this deck: max(0, owned - reservedElsewhere) */
	available: number
}

export const NO_COPIES: Availability = {
	owned: 0,
	reservedElsewhere: 0,
	reservedBy: [],
	available: 0,
}

/**
 * - ok: every copy is reserved from the collection
 * - missing: the user doesn't own enough copies
 * - inUseElsewhere: they own enough, but other decks hold some
 * - missingAndInUse: both
 * - unreserved: the copies are free, the deck just hasn't been filled since
 *   they were added (filling again takes them)
 */
export type FillStatusKind =
	| 'ok'
	| 'missing'
	| 'inUseElsewhere'
	| 'missingAndInUse'
	| 'unreserved'

export type FillStatus = {
	kind: FillStatusKind
	/** copies not reserved from the collection */
	short: number
	/** copies the user doesn't own */
	need: number
	/** copies the user owns that other decks hold */
	inUse: number
	/** free copies that filling again would reserve */
	unreserved: number
}

/**
 * Why a deck row has fewer copies from the collection than it plays. Filling
 * reserves `min(quantity, available)`; whatever that leaves short is split
 * into copies the user doesn't own and copies other decks hold.
 */
export function fillStatus({
	quantity,
	fromCollection,
	owned,
	available,
}: {
	quantity: number
	fromCollection: number
	owned: number
	available: number
}): FillStatus {
	const short = Math.max(0, quantity - fromCollection)
	if (short === 0) {
		return { kind: 'ok', short: 0, need: 0, inUse: 0, unreserved: 0 }
	}
	const canTake = Math.min(quantity, Math.max(0, available))
	const need = Math.max(0, quantity - owned)
	const inUse = Math.max(0, quantity - canTake - need)
	const unreserved = Math.max(0, canTake - fromCollection)
	const kind =
		need > 0 && inUse > 0
			? 'missingAndInUse'
			: need > 0
				? 'missing'
				: inUse > 0
					? 'inUseElsewhere'
					: 'unreserved'
	return { kind, short, need, inUse, unreserved }
}

/**
 * Whether the collection changed after filling so that the deck holds more
 * copies of a card than are left for it (fewer owned, or overlapping fills).
 */
export function isReservationStale(
	fromCollection: number,
	availability: Pick<Availability, 'available'>,
) {
	return fromCollection > availability.available
}
