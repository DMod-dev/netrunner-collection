// A deck as text, like NetrunnerDB's "Export as text". Pure, so the builder
// can copy it to the clipboard and the download route can send it.
import { type DeckEvaluation } from './deck-rules.ts'
import { type DeckSide, groupByType } from './deck.ts'

export type ExportableDeck = {
	name: string
	sideId: DeckSide
	identity: { title: string } | null
	cards: Array<{
		card: { id: string; title: string; typeId: string; typeName: string }
		quantity: number
	}>
}

/**
 * The deck's name, its identity, then a section per card type
 * ("Event (9)", "3x Sure Gamble ●●"), with a dot per point of influence the
 * card costs the deck, and the stats at the end. `parseDeckText` reads it
 * back as the same deck.
 */
export function toNrdbText(
	deck: ExportableDeck,
	{ stats, perCard }: Pick<DeckEvaluation, 'stats' | 'perCard'>,
) {
	const lines = [deck.name]
	if (deck.identity) lines.push(deck.identity.title)
	lines.push('')
	for (const group of groupByType(deck.cards, deck.sideId)) {
		lines.push(`${group.name} (${group.count})`)
		for (const { card, quantity } of group.entries) {
			const influence = perCard[card.id]?.influence ?? 0
			const pips = influence > 0 ? ` ${'●'.repeat(influence)}` : ''
			lines.push(`${quantity}x ${card.title}${pips}`)
		}
		lines.push('')
	}

	const cards = `${stats.cardCount} ${stats.cardCount === 1 ? 'card' : 'cards'}`
	lines.push(
		stats.minDeckSize === null ? cards : `${cards} (min ${stats.minDeckSize})`,
	)
	lines.push(
		stats.influenceLimit === null
			? `${stats.influenceSpent} influence spent`
			: `${stats.influenceSpent} influence spent (max ${stats.influenceLimit})`,
	)
	if (
		stats.agendaPoints !== null &&
		stats.agendaMin !== null &&
		stats.agendaMax !== null
	) {
		lines.push(
			`${stats.agendaPoints} agenda points (between ${stats.agendaMin} and ${stats.agendaMax})`,
		)
	}
	if (stats.points !== null && stats.pointLimit !== null) {
		lines.push(`${stats.points} format points (max ${stats.pointLimit})`)
	}
	return `${lines.join('\n')}\n`
}

/** A file name for the deck's text export. */
export function deckFileName(name: string) {
	const slug = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\w\s-]+/g, '')
		.trim()
		.replace(/\s+/g, '-')
	return `${slug || 'deck'}.txt`
}
