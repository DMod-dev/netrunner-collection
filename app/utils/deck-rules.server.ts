import { cachedUntilNextSync } from './card-data-cache.server.ts'
import { prisma } from './db.server.ts'

/**
 * What a format's current ban/restricted/points list says, as lookups by
 * card id. `Card.legalFormats` already says whether a card is in the format's
 * card pool; a card is legal if it's in the pool and not banned here.
 */
export type FormatRules = {
	formatId: string
	/** The list in force, or null if the format has none. */
	restrictionId: string | null
	restrictionName: string | null
	banned: Set<string>
	restricted: Set<string>
	/** Points each card costs (points lists, e.g. Eternal). */
	points: Map<string, number>
	pointLimit: number | null
	globalPenalty: Set<string>
	/** Extra influence a card costs whatever its faction. */
	universalFactionCost: Map<string, number>
	/** card_subtype_ids that are banned outright. */
	bannedSubtypes: Set<string>
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
		banned: new Set(),
		restricted: new Set(),
		points: new Map(),
		pointLimit: null,
		globalPenalty: new Set(),
		universalFactionCost: new Map(),
		bannedSubtypes: new Set(),
	}
	const restriction = format.activeRestrictionId
		? await prisma.restriction.findUnique({
				where: { id: format.activeRestrictionId },
				select: {
					id: true,
					name: true,
					pointLimit: true,
					bannedSubtypes: true,
					verdicts: { select: { cardId: true, verdict: true, value: true } },
				},
			})
		: null
	if (!restriction) return rules

	rules.restrictionId = restriction.id
	rules.restrictionName = restriction.name
	rules.pointLimit = restriction.pointLimit
	rules.bannedSubtypes = new Set(
		restriction.bannedSubtypes.split(',').filter(Boolean),
	)
	for (const { cardId, verdict, value } of restriction.verdicts) {
		switch (verdict) {
			case 'banned':
				rules.banned.add(cardId)
				break
			case 'restricted':
				rules.restricted.add(cardId)
				break
			case 'global_penalty':
				rules.globalPenalty.add(cardId)
				break
			case 'points':
				if (value !== null) rules.points.set(cardId, value)
				break
			case 'universal_faction_cost':
				if (value !== null) rules.universalFactionCost.set(cardId, value)
				break
		}
	}
	return rules
}
