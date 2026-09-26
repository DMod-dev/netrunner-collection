import { cachedUntilNextSync } from './card-data-cache.server.ts'
import { prisma } from './db.server.ts'
import { type CardLite, type FormatRules } from './deck-rules.ts'

/**
 * Startup's cap on agendas worth 3+ points, per list. NetrunnerDB's public
 * API doesn't include it (it's `max_3_point_agendas` in the lists in
 * NetrunnerDB/netrunner-cards-json), so it's copied here; a list missing from
 * this table has no cap.
 */
export const MAX_THREE_POINT_AGENDAS: Record<string, number> = {
	startup_ban_list_24_09: 3,
	startup_balance_update_25_04: 4,
	startup_balance_update_25_11: 4,
	startup_balance_update_26_03: 3,
	startup_balance_update_26_05: 4,
}

/**
 * The current rules for a format, or null if NRDB doesn't have the format.
 * Cached until the next NetrunnerDB sync.
 */
export async function getFormatRules(
	formatId: string,
): Promise<FormatRules | null> {
	return cachedUntilNextSync(`format-rules:${formatId}`, () =>
		loadFormatRules(formatId),
	)
}

async function loadFormatRules(formatId: string): Promise<FormatRules | null> {
	const format = await prisma.format.findUnique({
		where: { id: formatId },
		select: { activeRestrictionId: true },
	})
	if (!format) return null

	const rules: FormatRules = {
		formatId,
		restrictionId: null,
		restrictionName: null,
		banned: [],
		restricted: [],
		points: {},
		pointLimit: null,
		globalPenalty: [],
		universalFactionCost: {},
		bannedSubtypes: [],
		maxThreePointAgendas: null,
	}
	const restriction = format.activeRestrictionId
		? await prisma.restriction.findUnique({
				where: { id: format.activeRestrictionId },
				select: {
					id: true,
					name: true,
					pointLimit: true,
					bannedSubtypes: true,
					verdicts: {
						select: { cardId: true, verdict: true, value: true },
						orderBy: { cardId: 'asc' },
					},
				},
			})
		: null
	if (!restriction) return rules

	rules.restrictionId = restriction.id
	rules.restrictionName = restriction.name
	rules.pointLimit = restriction.pointLimit
	rules.bannedSubtypes = splitWrapped(restriction.bannedSubtypes)
	rules.maxThreePointAgendas = MAX_THREE_POINT_AGENDAS[restriction.id] ?? null
	for (const { cardId, verdict, value } of restriction.verdicts) {
		switch (verdict) {
			case 'banned':
				rules.banned.push(cardId)
				break
			case 'restricted':
				rules.restricted.push(cardId)
				break
			case 'global_penalty':
				rules.globalPenalty.push(cardId)
				break
			case 'points':
				if (value !== null) rules.points[cardId] = value
				break
			case 'universal_faction_cost':
				if (value !== null) rules.universalFactionCost[cardId] = value
				break
		}
	}
	return rules
}

/** "," or ",a,b," (how Card and Restriction store id lists) → ["a", "b"] */
function splitWrapped(ids: string) {
	return ids.split(',').filter(Boolean)
}

/** The Card columns `toCardLite` reads. */
export const CARD_LITE_SELECT = {
	id: true,
	title: true,
	sideId: true,
	factionId: true,
	typeId: true,
	subtypes: true,
	deckLimit: true,
	influenceCost: true,
	agendaPoints: true,
	minimumDeckSize: true,
	influenceLimit: true,
	legalFormats: true,
} as const

type CardRow = {
	[K in keyof typeof CARD_LITE_SELECT]: K extends 'subtypes' | 'legalFormats'
		? string
		: CardLite[K]
}

/**
 * A Card row as the deck rules take it (id lists split into arrays). Takes
 * just those fields, so a row selected with more doesn't carry them along.
 */
export function toCardLite(card: CardRow): CardLite {
	return {
		id: card.id,
		title: card.title,
		sideId: card.sideId,
		factionId: card.factionId,
		typeId: card.typeId,
		subtypes: splitWrapped(card.subtypes),
		deckLimit: card.deckLimit,
		influenceCost: card.influenceCost,
		agendaPoints: card.agendaPoints,
		minimumDeckSize: card.minimumDeckSize,
		influenceLimit: card.influenceLimit,
		legalFormats: splitWrapped(card.legalFormats),
	}
}
