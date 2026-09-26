/**
 * The formats players can pick: filters, deck legality and the deck builder.
 * NetrunnerDB has more (snapshots of old formats, casual variants); those are
 * synced too but not shown.
 */
export const DECK_FORMATS = ['standard', 'startup', 'eternal'] as const

export type DeckFormat = (typeof DECK_FORMATS)[number]

export const DECK_FORMAT_NAMES: Record<DeckFormat, string> = {
	standard: 'Standard',
	startup: 'Startup',
	eternal: 'Eternal',
}
