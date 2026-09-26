/**
 * Netrunner deckbuilding rules: given an identity, the cards and a format's
 * ban/points list, work out the deck's stats and what's wrong with it.
 *
 * Pure and client-safe (no Prisma, no Node APIs): loaders run it on the
 * server and the deck builder reruns it in the browser after each change.
 * Every rule is its own exported function over a `DeckContext`, and
 * `evaluateDeck` composes them.
 *
 * Checked against the card text and NetrunnerDB's own validator
 * (NetrunnerDB/netrunnerdb-api-server, lib/deck_validator.rb). Where the two
 * disagree, the card text wins; those places say so.
 */
import { DECK_FORMAT_NAMES, type DeckFormat } from './deck-formats.ts'

/** The card fields the rules need. `toCardLite` builds these from the DB. */
export type CardLite = {
	id: string
	title: string
	sideId: string
	factionId: string
	typeId: string
	/** NRDB card_subtype_ids, e.g. ["alliance", "virtual"] */
	subtypes: string[]
	deckLimit: number
	influenceCost: number | null
	agendaPoints: number | null
	/** identities only */
	minimumDeckSize: number | null
	/** identities only; null means no limit (e.g. Ampère) */
	influenceLimit: number | null
	/** formats whose current card pool has the card */
	legalFormats: string[]
}

/**
 * A format's current ban/restricted/points list, in a form that survives
 * JSON (loader data): arrays and records, not Sets and Maps.
 */
export type FormatRules = {
	formatId: string
	/** The list in force, or null if the format has none. */
	restrictionId: string | null
	restrictionName: string | null
	banned: string[]
	/** A deck can include at most one restricted card. */
	restricted: string[]
	/** Points each card costs (points lists, e.g. Eternal), once per card. */
	points: Record<string, number>
	pointLimit: number | null
	/** Each copy lowers the identity's influence limit by 1 (to at least 1). */
	globalPenalty: string[]
	/** Extra influence each copy costs, whatever its faction. */
	universalFactionCost: Record<string, number>
	/** card_subtype_ids that are banned outright. */
	bannedSubtypes: string[]
	/** Most agendas worth 3+ points a Corp deck can include (Startup). */
	maxThreePointAgendas: number | null
}

export type DeckEntry = { card: CardLite; quantity: number }

export type DeckInput = {
	identity: CardLite | null
	cards: DeckEntry[]
	formatId: DeckFormat
	/**
	 * On: the format's card pool, bans, restrictions and points are checked,
	 * as warnings. Off: they aren't checked at all.
	 */
	requireLegality: boolean
	rules: FormatRules | null
}

export type ProblemCode =
	| 'no_identity'
	| 'identity_in_deck'
	| 'wrong_side'
	| 'deck_size'
	| 'deck_limit'
	| 'no_influence_cost'
	| 'influence_limit'
	| 'out_of_faction_agenda'
	| 'ampere_agendas'
	| 'agenda_points'
	| 'identity_restriction'
	| 'not_in_format'
	| 'banned'
	| 'banned_subtype'
	| 'restricted'
	| 'points_limit'
	| 'three_point_agendas'

export type Problem = {
	code: ProblemCode
	severity: 'error' | 'warning'
	/** The card the problem is about, if it's about one card. */
	cardId?: string
	message: string
}

export type DeckStats = {
	/** Cards in the deck, not counting the identity (or Adam's directives). */
	cardCount: number
	minDeckSize: number | null
	influenceSpent: number
	/** After global penalties; null means no limit (or no identity). */
	influenceLimit: number | null
	/** Corp decks only */
	agendaPoints: number | null
	agendaMin: number | null
	agendaMax: number | null
	/** Formats with a points list only */
	points: number | null
	pointLimit: number | null
}

export type DeckEvaluation = {
	stats: DeckStats
	problems: Problem[]
	perCard: Record<string, { influence: number; problems: Problem[] }>
	/** No 'error' problems */
	isLegal: boolean
}

/** Everything a rule needs, worked out once per evaluation. */
export type DeckContext = {
	identity: CardLite | null
	side: string | null
	/** Every card in the list, one entry per card id. */
	all: DeckEntry[]
	/**
	 * The cards that make up the deck: `all` without identities, and without
	 * Adam's directives ("not considered part of your deck").
	 */
	deck: DeckEntry[]
	/**
	 * Adam's directives, set aside from `deck`. Which 3 he starts with is
	 * decided at game time, so they aren't checked.
	 */
	directives: DeckEntry[]
	cardCount: number
	formatId: DeckFormat
	requireLegality: boolean
	rules: {
		banned: Set<string>
		restricted: Set<string>
		points: Map<string, number>
		pointLimit: number | null
		globalPenalty: Set<string>
		universalFactionCost: Map<string, number>
		bannedSubtypes: Set<string>
		maxThreePointAgendas: number | null
	} | null
}

export const THE_PROFESSOR = 'the_professor_keeper_of_knowledge'
export const AMPERE = 'ampere_cybernetics_for_anyone'
export const ADAM = 'adam_compulsive_hacker'

/**
 * "Your deck cannot include more than 1 copy of any card." (Ampère:
 * Cybernetics For Anyone; Nova Initiumia: Catalyst & Impetus)
 */
export const SINGLETON_IDENTITIES = new Set([
	AMPERE,
	'nova_initiumia_catalyst_impetus',
])

/**
 * Identities whose text limits what else the deck can hold. `allows` is
 * false for a card that breaks the rule.
 */
export const IDENTITY_RESTRICTIONS: Record<
	string,
	{
		allows: (card: CardLite) => boolean
		severity: Problem['severity']
		message: (card: CardLite) => string
	}
> = {
	// Custom Biotics: "You cannot include Jinteki cards in this deck."
	custom_biotics_engineered_for_success: {
		allows: (card) => card.factionId !== 'jinteki',
		severity: 'error',
		message: (card) =>
			`Custom Biotics can’t include Jinteki cards: ${card.title}`,
	},
	// Apex: "You cannot install non-virtual resources." That limits play, not
	// deckbuilding, so the deck is still legal; the card just can't be used.
	apex_invasive_predator: {
		allows: (card) =>
			card.typeId !== 'resource' || card.subtypes.includes('virtual'),
		severity: 'warning',
		message: (card) =>
			`Apex can’t install non-virtual resources: ${card.title}`,
	},
}

/**
 * When an alliance card costs 0 influence, from its text. Each one's
 * condition only matters when it's out of faction.
 */
export const ALLIANCE_CONDITIONS: Record<
	string,
	(ctx: DeckContext) => boolean
> = {
	// "This card costs 0 influence if you have 6 or more non-alliance
	// [faction] cards in your deck."
	consulting_visit: sixNonAlliance('weyland_consortium'),
	executive_search_firm: sixNonAlliance('weyland_consortium'),
	heritage_committee: sixNonAlliance('jinteki'),
	raman_rai: sixNonAlliance('jinteki'),
	ibrahim_salem: sixNonAlliance('nbn'),
	salems_hospitality: sixNonAlliance('nbn'),
	jeeves_model_bioroids: sixNonAlliance('haas_bioroid'),
	product_recall: sixNonAlliance('haas_bioroid'),
	// "This card costs 0 influence if you have 15 or fewer ice in your deck."
	// (NRDB's validator checks 15 or more, the wrong way round.)
	mumba_temple: (ctx) => countCards(ctx, (c) => c.typeId === 'ice') <= 15,
	// "This upgrade costs 0 influence if you have 7 or more assets in your deck."
	mumbad_virtual_tour: (ctx) =>
		countCards(ctx, (c) => c.typeId === 'asset') >= 7,
	// "This asset costs 0 influence if you have 50 or more cards in your deck."
	museum_of_history: (ctx) => ctx.cardCount >= 50,
	// "This card costs 0 influence if you have 3 PAD Campaigns in your deck."
	pad_factory: (ctx) => countCards(ctx, (c) => c.id === 'pad_campaign') >= 3,
}

function sixNonAlliance(factionId: string) {
	return (ctx: DeckContext) =>
		countCards(
			ctx,
			(c) => c.factionId === factionId && !c.subtypes.includes('alliance'),
		) >= 6
}

function countCards(ctx: DeckContext, test: (card: CardLite) => boolean) {
	return ctx.deck.reduce((n, e) => (test(e.card) ? n + e.quantity : n), 0)
}

const CORP_FACTION_NAMES: Record<string, string> = {
	haas_bioroid: 'Haas-Bioroid',
	jinteki: 'Jinteki',
	nbn: 'NBN',
	weyland_consortium: 'Weyland Consortium',
}

export function isIdentity(card: Pick<CardLite, 'typeId'>) {
	return card.typeId.endsWith('_identity')
}

function isNeutral(card: CardLite) {
	return card.factionId.startsWith('neutral')
}

/** "Ampère: Cybernetics For Anyone" → "Ampère" */
function shortTitle(card: CardLite) {
	return card.title.split(':')[0]!
}

function plural(n: number, one: string, many = `${one}s`) {
	return `${n} ${n === 1 ? one : many}`
}

/**
 * The agenda points a Corp deck of `deckSize` cards needs: 2 for every 5
 * cards, plus 2, with 1 point of leeway (45–49 cards → 20–21).
 */
export function agendaPointRange(deckSize: number): [number, number] {
	const min = 2 * Math.floor(deckSize / 5) + 2
	return [min, min + 1]
}

export function deckContext(input: DeckInput): DeckContext {
	const byId = new Map<string, DeckEntry>()
	for (const { card, quantity } of input.cards) {
		if (quantity <= 0) continue
		const entry = byId.get(card.id)
		if (entry) entry.quantity += quantity
		else byId.set(card.id, { card, quantity })
	}
	const all = [...byId.values()]
	const isAdam = input.identity?.id === ADAM
	const isDirective = (e: DeckEntry) =>
		isAdam && e.card.subtypes.includes('directive')
	const deck = all.filter((e) => !isIdentity(e.card) && !isDirective(e))
	const { rules } = input
	return {
		identity: input.identity,
		side: input.identity?.sideId ?? all[0]?.card.sideId ?? null,
		all,
		deck,
		directives: all.filter(isDirective),
		cardCount: deck.reduce((n, e) => n + e.quantity, 0),
		formatId: input.formatId,
		requireLegality: input.requireLegality,
		rules: rules && {
			banned: new Set(rules.banned),
			restricted: new Set(rules.restricted),
			points: new Map(Object.entries(rules.points)),
			pointLimit: rules.pointLimit,
			globalPenalty: new Set(rules.globalPenalty),
			universalFactionCost: new Map(Object.entries(rules.universalFactionCost)),
			bannedSubtypes: new Set(rules.bannedSubtypes),
			maxThreePointAgendas: rules.maxThreePointAgendas,
		},
	}
}

/** Exactly one identity, given as `identity` and not among the cards. */
export function checkIdentity(ctx: DeckContext): Problem[] {
	const problems: Problem[] = []
	if (!ctx.identity || !isIdentity(ctx.identity)) {
		problems.push({
			code: 'no_identity',
			severity: 'error',
			message: 'The deck needs an identity',
		})
	}
	for (const { card } of ctx.all) {
		if (!isIdentity(card)) continue
		problems.push({
			code: 'identity_in_deck',
			severity: 'error',
			cardId: card.id,
			message: `${card.title} is an identity; a deck has just one, chosen separately`,
		})
	}
	return problems
}

/** Every card is on the identity's side. */
export function checkSides(ctx: DeckContext): Problem[] {
	const side = ctx.side
	if (!side) return []
	const sideName = side === 'corp' ? 'Corp' : 'Runner'
	return ctx.all
		.filter(({ card }) => card.sideId !== side && !isIdentity(card))
		.map(({ card }) => ({
			code: 'wrong_side',
			severity: 'error',
			cardId: card.id,
			message: `${card.title} can’t go in a ${sideName} deck`,
		}))
}

/** At least the identity's minimum deck size. */
export function checkDeckSize(ctx: DeckContext): Problem[] {
	const min = ctx.identity?.minimumDeckSize
	if (min == null || ctx.cardCount >= min) return []
	return [
		{
			code: 'deck_size',
			severity: 'error',
			message: `${plural(ctx.cardCount, 'card')}; ${shortTitle(ctx.identity!)} needs at least ${min}`,
		},
	]
}

/** No more copies than a card's deck limit (1 of anything for singleton identities). */
export function checkDeckLimits(ctx: DeckContext): Problem[] {
	const singleton = SINGLETON_IDENTITIES.has(ctx.identity?.id ?? '')
	return ctx.deck.flatMap(({ card, quantity }): Problem[] => {
		const limit = singleton ? 1 : card.deckLimit
		if (quantity <= limit) return []
		return [
			{
				code: 'deck_limit',
				severity: 'error',
				cardId: card.id,
				message: `${quantity} copies of ${card.title}; the limit is ${limit}${singleton ? ` with ${shortTitle(ctx.identity!)}` : ''}`,
			},
		]
	})
}

function isAllianceFree(card: CardLite, ctx: DeckContext) {
	return (
		card.subtypes.includes('alliance') &&
		(ALLIANCE_CONDITIONS[card.id]?.(ctx) ?? false)
	)
}

/**
 * The influence `quantity` copies of `card` cost this deck: nothing in
 * faction, else the card's cost per copy. The Professor's first copy of each
 * program is free, and alliance cards are free when their condition holds. A
 * universal faction cost is added per copy either way.
 */
export function influenceFor(
	card: CardLite,
	quantity: number,
	ctx: DeckContext,
): number {
	const universal =
		(ctx.rules?.universalFactionCost.get(card.id) ?? 0) * quantity
	const { identity } = ctx
	if (!identity || isIdentity(card) || card.factionId === identity.factionId) {
		return universal
	}
	if (isAllianceFree(card, ctx)) return universal
	// The Professor: "The first copy of each program in this deck does not
	// count against your influence limit."
	const copies =
		identity.id === THE_PROFESSOR && card.typeId === 'program'
			? Math.max(0, quantity - 1)
			: quantity
	return (card.influenceCost ?? 0) * copies + universal
}

/** Influence spent across the deck. */
export function influenceSpent(ctx: DeckContext) {
	return ctx.deck.reduce((n, e) => n + influenceFor(e.card, e.quantity, ctx), 0)
}

/**
 * The identity's influence limit, less 1 per copy of a global-penalty card
 * (to at least 1). Null when there's no limit.
 */
export function influenceLimit(ctx: DeckContext): number | null {
	const limit = ctx.identity?.influenceLimit ?? null
	if (limit === null || !ctx.rules) return limit
	const penalty = countCards(ctx, (c) => ctx.rules!.globalPenalty.has(c.id))
	return penalty ? Math.max(1, limit - penalty) : limit
}

/**
 * Out-of-faction cards need an influence cost, and the total stays within
 * the limit. (Agendas have no cost; `checkAgendas` covers them.)
 */
export function checkInfluence(ctx: DeckContext): Problem[] {
	const { identity } = ctx
	if (!identity) return []
	const problems: Problem[] = ctx.deck
		.filter(
			({ card }) =>
				card.factionId !== identity.factionId &&
				!isNeutral(card) &&
				card.typeId !== 'agenda' &&
				card.influenceCost === null,
		)
		.map(({ card }) => ({
			code: 'no_influence_cost',
			severity: 'error',
			cardId: card.id,
			message: `${card.title} can’t be played out of faction`,
		}))
	const limit = influenceLimit(ctx)
	const spent = influenceSpent(ctx)
	if (limit !== null && spent > limit) {
		problems.push({
			code: 'influence_limit',
			severity: 'error',
			message: `${spent - limit} influence over the limit of ${limit}`,
		})
	}
	return problems
}

/** Agenda points total, or null for a Runner deck. */
export function agendaPoints(ctx: DeckContext): number | null {
	if (ctx.side !== 'corp') return null
	return ctx.deck.reduce(
		(n, e) =>
			e.card.typeId === 'agenda'
				? n + (e.card.agendaPoints ?? 0) * e.quantity
				: n,
		0,
	)
}

/** The deck size agenda points are judged against: never below the minimum. */
function agendaDeckSize(ctx: DeckContext) {
	return Math.max(ctx.cardCount, ctx.identity?.minimumDeckSize ?? 0)
}

/**
 * Corp decks: agendas in faction or neutral (Ampère: up to 2 different
 * agendas from each Corp faction), and agenda points in range for the deck
 * size.
 */
export function checkAgendas(ctx: DeckContext): Problem[] {
	const points = agendaPoints(ctx)
	if (points === null) return []
	const problems: Problem[] = []
	const agendas = ctx.deck.filter((e) => e.card.typeId === 'agenda')
	const { identity } = ctx
	if (identity?.id === AMPERE) {
		// "Your deck may include up to 2 different agenda cards from each Corp
		// faction."
		const perFaction = new Map<string, number>()
		for (const { card } of agendas) {
			if (isNeutral(card)) continue
			perFaction.set(card.factionId, (perFaction.get(card.factionId) ?? 0) + 1)
		}
		for (const [factionId, count] of perFaction) {
			if (count <= 2) continue
			const faction = CORP_FACTION_NAMES[factionId] ?? factionId
			problems.push({
				code: 'ampere_agendas',
				severity: 'error',
				message: `${count} different ${faction} agendas; Ampère can include 2`,
			})
		}
	} else if (identity) {
		for (const { card } of agendas) {
			if (card.factionId === identity.factionId || isNeutral(card)) continue
			problems.push({
				code: 'out_of_faction_agenda',
				severity: 'error',
				cardId: card.id,
				message: `${card.title} is out of faction; agendas must be in faction or neutral`,
			})
		}
	}
	const deckSize = agendaDeckSize(ctx)
	const [min, max] = agendaPointRange(deckSize)
	if (points < min || points > max) {
		problems.push({
			code: 'agenda_points',
			severity: 'error',
			message: `${plural(points, 'agenda point')}; a ${deckSize}-card deck needs ${min} or ${max}`,
		})
	}
	return problems
}

/** Identity text that rules cards out: see `IDENTITY_RESTRICTIONS`. */
export function checkIdentityRestrictions(ctx: DeckContext): Problem[] {
	const restriction = IDENTITY_RESTRICTIONS[ctx.identity?.id ?? '']
	if (!restriction) return []
	return ctx.deck
		.filter(({ card }) => !restriction.allows(card))
		.map(({ card }) => ({
			code: 'identity_restriction',
			severity: restriction.severity,
			cardId: card.id,
			message: restriction.message(card),
		}))
}

/** Points total for a format with a points list, else null. */
export function formatPoints(ctx: DeckContext): number | null {
	const rules = ctx.rules
	if (!rules || rules.pointLimit === null) return null
	return withIdentity(ctx).reduce(
		(n, card) => n + (rules.points.get(card.id) ?? 0),
		0,
	)
}

/** The identity and every distinct card in the list. */
function withIdentity(ctx: DeckContext) {
	const cards = ctx.all.map((e) => e.card)
	return ctx.identity ? [ctx.identity, ...cards] : cards
}

/** The ban list `formatIssue` needs, as sets. */
export type BanList = {
	banned: ReadonlySet<string>
	bannedSubtypes: ReadonlySet<string>
}

export function toBanList(
	rules: Pick<FormatRules, 'banned' | 'bannedSubtypes'> | null,
): BanList | null {
	return (
		rules && {
			banned: new Set(rules.banned),
			bannedSubtypes: new Set(rules.bannedSubtypes),
		}
	)
}

/**
 * Why a card can't be played in the format, if it can't: it's outside the
 * card pool, banned, or of a banned subtype. "Remove cards not legal" takes
 * out exactly these.
 */
export function formatIssue(
	card: Pick<CardLite, 'id' | 'legalFormats' | 'subtypes'>,
	formatId: DeckFormat,
	banList: BanList | null,
):
	| { code: 'not_in_format' }
	| { code: 'banned' }
	| { code: 'banned_subtype'; subtype: string }
	| null {
	if (!card.legalFormats.includes(formatId)) return { code: 'not_in_format' }
	if (banList?.banned.has(card.id)) return { code: 'banned' }
	const subtype = card.subtypes.find((s) => banList?.bannedSubtypes.has(s))
	return subtype ? { code: 'banned_subtype', subtype } : null
}

/**
 * The format's card pool and ban/restricted/points list, only when the deck
 * is to be kept legal, and then only as warnings: a deck can still be saved
 * and played casually.
 */
export function checkFormat(ctx: DeckContext): Problem[] {
	if (!ctx.requireLegality) return []
	const severity = 'warning'
	const format = DECK_FORMAT_NAMES[ctx.formatId]
	const problems: Problem[] = []
	const cards = withIdentity(ctx)
	const rules = ctx.rules
	for (const card of cards) {
		const issue = formatIssue(card, ctx.formatId, rules)
		if (!issue) continue
		problems.push({
			code: issue.code,
			severity,
			cardId: card.id,
			message:
				issue.code === 'not_in_format'
					? `${card.title} isn’t legal in ${format}`
					: issue.code === 'banned'
						? `${card.title} is banned in ${format}`
						: `${card.title} is banned in ${format} (all ${issue.subtype.replaceAll('_', ' ')} cards are)`,
		})
	}
	if (!rules) return problems

	const restricted = cards.filter((card) => rules.restricted.has(card.id))
	if (restricted.length > 1) {
		for (const card of restricted) {
			problems.push({
				code: 'restricted',
				severity,
				cardId: card.id,
				message: `${card.title} is 1 of ${restricted.length} restricted cards; ${format} allows 1`,
			})
		}
	}

	const points = formatPoints(ctx)
	if (
		points !== null &&
		rules.pointLimit !== null &&
		points > rules.pointLimit
	) {
		problems.push({
			code: 'points_limit',
			severity,
			message: `${plural(points, 'point')}; ${format} allows ${rules.pointLimit}`,
		})
	}

	const max = rules.maxThreePointAgendas
	if (max !== null && ctx.side === 'corp') {
		const count = countCards(
			ctx,
			(c) => c.typeId === 'agenda' && (c.agendaPoints ?? 0) >= 3,
		)
		if (count > max) {
			problems.push({
				code: 'three_point_agendas',
				severity,
				message: `${plural(count, 'agenda')} worth 3 or more points; ${format} allows ${max}`,
			})
		}
	}
	return problems
}

/** The rules `evaluateDeck` applies, in the order problems are listed. */
export const DECK_RULES: Array<(ctx: DeckContext) => Problem[]> = [
	checkIdentity,
	checkSides,
	checkDeckSize,
	checkDeckLimits,
	checkInfluence,
	checkAgendas,
	checkIdentityRestrictions,
	checkFormat,
]

export function evaluateDeck(input: DeckInput): DeckEvaluation {
	const ctx = deckContext(input)
	const problems = DECK_RULES.flatMap((rule) => rule(ctx))

	const perCard: DeckEvaluation['perCard'] = {}
	for (const card of withIdentity(ctx)) {
		perCard[card.id] = { influence: 0, problems: [] }
	}
	for (const { card, quantity } of ctx.deck) {
		perCard[card.id]!.influence = influenceFor(card, quantity, ctx)
	}
	for (const problem of problems) {
		if (problem.cardId) perCard[problem.cardId]?.problems.push(problem)
	}

	const isCorp = ctx.side === 'corp'
	const [agendaMin, agendaMax] = isCorp
		? agendaPointRange(agendaDeckSize(ctx))
		: [null, null]
	return {
		stats: {
			cardCount: ctx.cardCount,
			minDeckSize: ctx.identity?.minimumDeckSize ?? null,
			influenceSpent: influenceSpent(ctx),
			influenceLimit: influenceLimit(ctx),
			agendaPoints: agendaPoints(ctx),
			agendaMin,
			agendaMax,
			points: formatPoints(ctx),
			pointLimit: ctx.rules?.pointLimit ?? null,
		},
		problems,
		perCard,
		isLegal: problems.every((p) => p.severity !== 'error'),
	}
}
