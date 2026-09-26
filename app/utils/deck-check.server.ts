import { cachedUntilNextSync } from './card-data-cache.server.ts'
import { pickArtPrinting } from './collection.ts'
import { prisma } from './db.server.ts'
import { getAvailability } from './deck-fill.server.ts'
import { fillStatus, NO_COPIES } from './deck-fill.ts'
import { isIdentity } from './deck-rules.ts'
import { NRDB_JSON_API_HEADERS, NRDB_USER_AGENT } from './nrdb.server.ts'

/** How long a deck check waits for NetrunnerDB before giving up. */
export const NRDB_FETCH_TIMEOUT_MS = 10_000

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export type NrdbDeckRef = {
	/** "decklist" = published decklist, "deck" = privately shared deck */
	kind: 'decklist' | 'deck'
	id: string
}

/**
 * Recognise a NetrunnerDB deck link (or a bare deck id) in the input. Only
 * the id is used, so we never fetch an arbitrary URL.
 */
export function parseNrdbDeckRef(input: string): NrdbDeckRef | null {
	const text = input.trim()
	if (text.includes('\n')) return null
	const id = UUID.exec(text)?.[0]?.toLowerCase()
	if (!id) return null
	if (/netrunnerdb\.com\/[a-z]{2}\/deck\//i.test(text)) {
		return { kind: 'deck', id }
	}
	if (/netrunnerdb\.com/i.test(text) || text.toLowerCase() === id) {
		return { kind: 'decklist', id }
	}
	return null
}

export type DeckRequirements = {
	name: string | null
	nrdbUrl: string | null
	/** copies needed per card id */
	cards: Map<string, number>
	/** counted lines we couldn't match to a card */
	unrecognized: Array<string>
}

export class DeckImportError extends Error {}

/**
 * Fetch from NetrunnerDB with a deadline. A request that hangs would
 * otherwise hold the user's submission (and a server slot) open indefinitely;
 * a timeout or network failure becomes a DeckImportError the page can show.
 */
async function fetchNrdb(
	url: string,
	headers: Record<string, string>,
	timeoutMs: number,
) {
	try {
		return await fetch(url, {
			headers,
			signal: AbortSignal.timeout(timeoutMs),
		})
	} catch (error) {
		if (error instanceof Error && error.name === 'TimeoutError') {
			throw new DeckImportError(
				"NetrunnerDB didn't respond in time. Try again in a minute.",
			)
		}
		throw new DeckImportError(
			"Couldn't reach NetrunnerDB. Try again in a minute.",
		)
	}
}

export async function fetchNrdbDeck(
	ref: NrdbDeckRef,
	{ timeoutMs = NRDB_FETCH_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<DeckRequirements> {
	if (ref.kind === 'decklist') {
		const response = await fetchNrdb(
			`https://api.netrunnerdb.com/api/v3/public/decklists/${ref.id}`,
			NRDB_JSON_API_HEADERS,
			timeoutMs,
		)
		if (response.status === 404) {
			throw new DeckImportError(
				"NetrunnerDB doesn't have a published decklist with that id.",
			)
		}
		if (!response.ok) {
			throw new DeckImportError(
				`NetrunnerDB returned an error (${response.status}). Try again later.`,
			)
		}
		const { data } = (await response.json()) as {
			data: {
				attributes: { name: string; card_slots: Record<string, number> }
			}
		}
		return {
			name: data.attributes.name,
			nrdbUrl: `https://netrunnerdb.com/en/decklist/${ref.id}`,
			cards: new Map(Object.entries(data.attributes.card_slots)),
			unrecognized: [],
		}
	}

	// Privately shared decks are only in the v2 API, keyed by printing code.
	const response = await fetchNrdb(
		`https://netrunnerdb.com/api/2.0/public/deck/${ref.id}`,
		{ 'user-agent': NRDB_USER_AGENT },
		timeoutMs,
	)
	if (!response.ok) {
		throw new DeckImportError(
			response.status === 404
				? "Couldn't load that deck. Make sure it's shared (NetrunnerDB: deck settings → Share) or published."
				: `NetrunnerDB returned an error (${response.status}). Try again later.`,
		)
	}
	const body = (await response.json()) as {
		data: Array<{ name: string; cards: Record<string, number> }>
	}
	const deck = body.data[0]
	if (!deck) throw new DeckImportError('That deck is empty.')
	const printings = await prisma.printing.findMany({
		where: { id: { in: Object.keys(deck.cards) } },
		select: { id: true, cardId: true },
	})
	const cardIdByPrinting = new Map(printings.map((p) => [p.id, p.cardId]))
	const cards = new Map<string, number>()
	const unrecognized: Array<string> = []
	for (const [printingId, count] of Object.entries(deck.cards)) {
		const cardId = cardIdByPrinting.get(printingId)
		if (!cardId) {
			unrecognized.push(`${count}x card #${printingId}`)
			continue
		}
		cards.set(cardId, (cards.get(cardId) ?? 0) + count)
	}
	return {
		name: deck.name,
		nrdbUrl: `https://netrunnerdb.com/en/deck/view/${ref.id}`,
		cards,
		unrecognized,
	}
}

/** Lowercase, accent- and punctuation-free, for matching card names. */
export function normalizeTitle(title: string) {
	return title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[“”"'‘’`]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
}

type ParsedLine = {
	count: number | null
	name: string
	/** the whole cleaned line, for names that start with a number */
	line: string
}

/** Pull a count and card name out of one decklist line, in common formats. */
export function parseDeckLine(rawLine: string): ParsedLine | null {
	const line = rawLine
		// influence pips and anything after them
		.replace(/\s*[●○•★☆◦].*$/u, '')
		.trim()
	if (!line) return null
	// section headers like "Event (13)" or "ICE (17)"
	if (/^[A-Za-z][A-Za-z ]*\(\d+\)$/.test(line)) return null

	let count: number | null = null
	let name = line
	const leading = /^(\d+)\s*[x×]?\s+(.+)$/i.exec(line)
	const trailing = /^(.+?)\s+[x×]\s*(\d+)$/i.exec(line)
	if (leading) {
		count = Number(leading[1])
		name = leading[2]!
	} else if (trailing) {
		name = trailing[1]!
		count = Number(trailing[2])
	}
	// deck summary lines like "45 cards" or "15 influence spent"
	if (
		count !== null &&
		/^(cards?|influence|agenda points?|format points?)\b/i.test(name)
	) {
		return null
	}
	// "(System Gateway)" or "[sg]" set annotations
	name = name.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim()
	return name ? { count, name, line } : null
}

// Building the index reads every card, so it is kept until the next sync
// rather than rebuilt for each pasted deck.
function getTitleIndex() {
	return cachedUntilNextSync('deck-check:title-index', buildTitleIndex)
}

async function buildTitleIndex() {
	const cards = await prisma.card.findMany({
		select: { id: true, title: true, strippedTitle: true },
	})
	const byTitle = new Map<string, string>()
	// identities are often written without their subtitle, e.g. "Loup"
	const byShortTitle = new Map<string, string | null>()
	for (const card of cards) {
		for (const title of [card.title, card.strippedTitle]) {
			byTitle.set(normalizeTitle(title), card.id)
			const short = title.includes(':') ? title.split(':')[0]! : null
			if (short) {
				const key = normalizeTitle(short)
				const existing = byShortTitle.get(key)
				byShortTitle.set(
					key,
					existing === undefined || existing === card.id ? card.id : null,
				)
			}
		}
	}
	return (name: string) => {
		const key = normalizeTitle(name)
		return byTitle.get(key) ?? byShortTitle.get(key) ?? null
	}
}

/** Parse a pasted decklist (NRDB text export, Jinteki, or plain "3x Card"). */
export async function parseDeckText(text: string): Promise<DeckRequirements> {
	const findCard = await getTitleIndex()
	const cards = new Map<string, number>()
	const unrecognized: Array<string> = []
	let name: string | null = null

	for (const rawLine of text.split(/\r?\n/)) {
		const parsed = parseDeckLine(rawLine)
		if (!parsed) continue
		let cardId = findCard(parsed.name)
		let count = parsed.count ?? 1
		// "15 Minutes" is a card, not 15 × "Minutes"
		if (!cardId && parsed.count !== null) {
			cardId = findCard(parsed.line)
			if (cardId) count = 1
		}
		if (cardId) {
			cards.set(cardId, (cards.get(cardId) ?? 0) + count)
		} else if (parsed.count !== null) {
			unrecognized.push(rawLine.trim())
		} else if (name === null && cards.size === 0) {
			// an unmatched line without a count before any cards: the deck name
			name = parsed.name
		}
	}
	return { name, nrdbUrl: null, cards, unrecognized }
}

/**
 * Compare a deck's requirements with what the user owns, and with what
 * their decks filled from the collection already hold: each row is what
 * filling a deck with these cards would find.
 */
export async function checkDeckAgainstCollection(
	userId: string,
	requirements: DeckRequirements,
) {
	const cardIds = [...requirements.cards.keys()]
	const [cards, availability] = await Promise.all([
		prisma.card.findMany({
			where: { id: { in: cardIds } },
			select: {
				id: true,
				title: true,
				typeId: true,
				type: { select: { name: true } },
				faction: { select: { id: true, name: true } },
				printings: {
					orderBy: { dateRelease: 'desc' },
					select: {
						id: true,
						imageSmall: true,
						set: { select: { name: true } },
						collectionEntries: {
							where: { userId },
							select: { quantity: true },
						},
						variants: {
							where: { userId, quantity: { gt: 0 } },
							select: { label: true, quantity: true },
						},
					},
				},
				preferredArt: { where: { userId }, select: { printingId: true } },
			},
		}),
		getAvailability(userId, cardIds, null),
	])

	const rows = cards.map((card) => {
		const need = requirements.cards.get(card.id) ?? 0
		const sources: Array<{ label: string; quantity: number }> = []
		for (const printing of card.printings) {
			const plain = printing.collectionEntries[0]?.quantity ?? 0
			if (plain > 0) sources.push({ label: printing.set.name, quantity: plain })
			for (const variant of printing.variants) {
				sources.push({
					label: `${printing.set.name} – ${variant.label}`,
					quantity: variant.quantity,
				})
			}
		}
		const owned = sources.reduce((sum, s) => sum + s.quantity, 0)
		const { reservedElsewhere, reservedBy } =
			availability.get(card.id) ?? NO_COPIES
		const available = Math.max(0, owned - reservedElsewhere)
		return {
			id: card.id,
			title: card.title,
			typeId: card.typeId,
			typeName: card.type.name,
			factionId: card.faction.id,
			imageSmall:
				pickArtPrinting(card.printings, card.preferredArt[0]?.printingId)
					?.imageSmall ?? null,
			isIdentity: isIdentity(card),
			need,
			owned,
			missing: Math.max(0, need - owned),
			reservedElsewhere,
			reservedBy,
			// as if filled: whatever is free is taken
			status: fillStatus({
				quantity: need,
				fromCollection: Math.min(need, available),
				owned,
				available,
			}),
			sources,
		}
	})
	rows.sort(
		(a, b) =>
			Number(b.isIdentity) - Number(a.isIdentity) ||
			a.typeName.localeCompare(b.typeName) ||
			a.title.localeCompare(b.title),
	)

	const missingRows = rows.filter((r) => r.missing > 0)
	return {
		name: requirements.name,
		nrdbUrl: requirements.nrdbUrl,
		unrecognized: requirements.unrecognized,
		rows,
		totalCards: rows.reduce((sum, r) => sum + r.need, 0),
		missingCards: missingRows.reduce((sum, r) => sum + r.missing, 0),
		missingUnique: missingRows.length,
		/** copies owned but held by decks filled from the collection */
		inUseCards: rows.reduce((sum, r) => sum + r.status.inUse, 0),
	}
}
