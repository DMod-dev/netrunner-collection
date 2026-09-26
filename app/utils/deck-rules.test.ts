import { describe, expect, test } from 'vitest'
import {
	CARDS,
	ETERNAL_RULES,
	PRECISION_DESIGN,
	STANDARD_RULES,
	STARTUP_RULES,
	WC_2017_CORP,
	WC_2017_RUNNER,
	type DeckList,
} from '#tests/fixtures/decks.ts'
import {
	agendaPointRange,
	deckContext,
	evaluateDeck,
	influenceFor,
	isIdentity,
	type CardLite,
	type DeckInput,
	type FormatRules,
} from './deck-rules.ts'

/** A card with sensible defaults: a 3-of in-faction Corp operation. */
function card(overrides: Partial<CardLite> & { title: string }): CardLite {
	return {
		id: overrides.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_'),
		sideId: 'corp',
		factionId: 'haas_bioroid',
		typeId: 'operation',
		subtypes: [],
		deckLimit: 3,
		influenceCost: 1,
		agendaPoints: null,
		minimumDeckSize: null,
		influenceLimit: null,
		legalFormats: ['standard', 'startup', 'eternal'],
		...overrides,
	}
}

function identity(overrides: Partial<CardLite> & { title: string }) {
	return card({
		typeId: overrides.sideId === 'runner' ? 'runner_identity' : 'corp_identity',
		deckLimit: 1,
		influenceCost: null,
		minimumDeckSize: 45,
		influenceLimit: 15,
		...overrides,
	})
}

const HB = identity({ title: 'Haas-Bioroid: Test ID' })
const agenda2 = (n: number) =>
	card({
		title: `HB Two Pointer ${n}`,
		typeId: 'agenda',
		influenceCost: null,
		agendaPoints: 2,
	})
const agenda1 = card({
	title: 'HB One Pointer',
	typeId: 'agenda',
	influenceCost: null,
	agendaPoints: 1,
})
const filler = (n: number, overrides: Partial<CardLite> = {}) =>
	card({ title: `Filler ${n}`, ...overrides })

/** `count` copies spread over 3-ofs of `make(0)`, `make(1)`… */
function threeOfs(count: number, make: (n: number) => CardLite) {
	return Array.from({ length: Math.ceil(count / 3) }, (_, n) => ({
		card: make(n),
		quantity: Math.min(3, count - n * 3),
	}))
}

/**
 * A Corp deck of `size` cards with `points` agenda points (2-pointers, then a
 * 1-pointer if odd) and in-faction filler for the rest.
 */
function corpCards(size: number, points: number) {
	const twos = Math.floor(points / 2)
	const ones = points % 2
	return [
		...threeOfs(twos, agenda2),
		...(ones ? [{ card: agenda1, quantity: 1 }] : []),
		...threeOfs(size - twos - ones, (n) => filler(n)),
	]
}

function evaluate(input: Partial<DeckInput>) {
	return evaluateDeck({
		identity: HB,
		cards: corpCards(45, 20),
		formatId: 'standard',
		requireLegality: true,
		rules: null,
		...input,
	})
}

const codes = (e: ReturnType<typeof evaluateDeck>) =>
	e.problems.map((p) => p.code)

function rules(overrides: Partial<FormatRules>): FormatRules {
	return {
		formatId: 'standard',
		restrictionId: 'test_list',
		restrictionName: 'Test List',
		banned: [],
		restricted: [],
		points: {},
		pointLimit: null,
		globalPenalty: [],
		universalFactionCost: {},
		bannedSubtypes: [],
		maxThreePointAgendas: null,
		...overrides,
	}
}

function fromList(deck: DeckList, extra: Partial<DeckInput> = {}): DeckInput {
	return {
		identity: CARDS[deck.identity],
		cards: deck.cards.map(([id, quantity]) => ({ card: CARDS[id], quantity })),
		formatId: 'standard',
		requireLegality: true,
		rules: STANDARD_RULES,
		...extra,
	}
}

test('isIdentity', () => {
	expect(isIdentity({ typeId: 'corp_identity' })).toBe(true)
	expect(isIdentity({ typeId: 'runner_identity' })).toBe(true)
	expect(isIdentity({ typeId: 'agenda' })).toBe(false)
})

describe('agenda points', () => {
	test('range by deck size', () => {
		expect(agendaPointRange(40)).toEqual([18, 19])
		expect(agendaPointRange(44)).toEqual([18, 19])
		expect(agendaPointRange(45)).toEqual([20, 21])
		expect(agendaPointRange(49)).toEqual([20, 21])
		expect(agendaPointRange(50)).toEqual([22, 23])
		expect(agendaPointRange(54)).toEqual([22, 23])
	})

	test('a 45-card deck needs 20 or 21', () => {
		for (const points of [20, 21]) {
			const result = evaluate({ cards: corpCards(45, points) })
			expect(result.problems).toEqual([])
			expect(result.isLegal).toBe(true)
			expect(result.stats).toMatchObject({
				cardCount: 45,
				agendaPoints: points,
				agendaMin: 20,
				agendaMax: 21,
			})
		}
		for (const points of [19, 22]) {
			const result = evaluate({ cards: corpCards(45, points) })
			expect(result.problems).toEqual([
				{
					code: 'agenda_points',
					severity: 'error',
					message: `${points} agenda points; a 45-card deck needs 20 or 21`,
				},
			])
			expect(result.isLegal).toBe(false)
		}
	})

	test('an undersized deck is judged at its minimum size', () => {
		const result = evaluate({ cards: corpCards(40, 18) })
		expect(codes(result)).toEqual(['deck_size', 'agenda_points'])
		expect(result.stats).toMatchObject({ agendaMin: 20, agendaMax: 21 })
		expect(result.problems[0]!.message).toBe(
			'40 cards; Haas-Bioroid needs at least 45',
		)
	})

	test('Runner decks have none', () => {
		const result = evaluate({
			identity: identity({
				title: 'Runner',
				sideId: 'runner',
				factionId: 'anarch',
			}),
			cards: [
				{
					card: filler(0, { sideId: 'runner', factionId: 'anarch' }),
					quantity: 3,
				},
			],
		})
		expect(result.stats).toMatchObject({
			agendaPoints: null,
			agendaMin: null,
			agendaMax: null,
		})
		expect(codes(result)).toEqual(['deck_size'])
	})

	test('agendas must be in faction or neutral', () => {
		const nbnAgenda = card({
			title: 'NBN Agenda',
			factionId: 'nbn',
			typeId: 'agenda',
			influenceCost: null,
			agendaPoints: 2,
		})
		const neutralAgenda = card({
			title: 'Neutral Agenda',
			factionId: 'neutral_corp',
			typeId: 'agenda',
			influenceCost: 0,
			agendaPoints: 2,
		})
		const base = corpCards(42, 14)
		expect(
			evaluate({ cards: [...base, { card: neutralAgenda, quantity: 3 }] })
				.problems,
		).toEqual([])
		const result = evaluate({
			cards: [...base, { card: nbnAgenda, quantity: 3 }],
		})
		expect(result.problems).toEqual([
			{
				code: 'out_of_faction_agenda',
				severity: 'error',
				cardId: 'nbn_agenda',
				message:
					'NBN Agenda is out of faction; agendas must be in faction or neutral',
			},
		])
		expect(result.perCard.nbn_agenda!.problems).toHaveLength(1)
	})
})

describe('influence', () => {
	const outOfFaction = card({
		title: 'Jinteki Op',
		factionId: 'jinteki',
		influenceCost: 2,
	})

	test('in faction is free; out of faction costs per copy', () => {
		const ctx = deckContext({
			identity: HB,
			cards: [],
			formatId: 'standard',
			requireLegality: true,
			rules: null,
		})
		expect(influenceFor(filler(0), 3, ctx)).toBe(0)
		expect(influenceFor(outOfFaction, 3, ctx)).toBe(6)
		expect(
			influenceFor(
				card({ title: 'Neutral', factionId: 'neutral_corp', influenceCost: 1 }),
				2,
				ctx,
			),
		).toBe(2)
	})

	test('stats and per-card influence', () => {
		const result = evaluate({
			cards: [...corpCards(42, 20), { card: outOfFaction, quantity: 3 }],
		})
		expect(result.problems).toEqual([])
		expect(result.stats).toMatchObject({
			influenceSpent: 6,
			influenceLimit: 15,
		})
		expect(result.perCard.jinteki_op).toEqual({ influence: 6, problems: [] })
		expect(result.perCard.filler_0).toEqual({ influence: 0, problems: [] })
	})

	test('over the limit', () => {
		const pricey = card({
			title: 'Pricey',
			factionId: 'jinteki',
			influenceCost: 3,
		})
		const result = evaluate({
			cards: [
				...corpCards(39, 20),
				{ card: pricey, quantity: 3 },
				{ card: outOfFaction, quantity: 3 },
			],
		})
		expect(result.stats.influenceSpent).toBe(15)
		expect(result.problems).toEqual([])

		const over = evaluate({
			cards: [
				...corpCards(38, 20),
				{ card: pricey, quantity: 3 },
				{ card: outOfFaction, quantity: 3 },
				{
					card: card({ title: 'One More', factionId: 'nbn', influenceCost: 3 }),
					quantity: 1,
				},
			],
		})
		expect(over.problems).toEqual([
			{
				code: 'influence_limit',
				severity: 'error',
				message: '3 influence over the limit of 15',
			},
		])
	})

	test('a card with no influence cost can’t be played out of faction', () => {
		const result = evaluate({
			cards: [
				...corpCards(44, 20),
				{
					card: card({
						title: 'Locked',
						factionId: 'nbn',
						influenceCost: null,
					}),
					quantity: 1,
				},
			],
		})
		expect(result.problems).toEqual([
			{
				code: 'no_influence_cost',
				severity: 'error',
				cardId: 'locked',
				message: 'Locked can’t be played out of faction',
			},
		])
	})

	test('no limit never errors', () => {
		const result = evaluate({
			identity: { ...HB, influenceLimit: null },
			cards: [
				...corpCards(36, 20),
				{ card: outOfFaction, quantity: 3 },
				{ card: { ...outOfFaction, id: 'b', influenceCost: 5 }, quantity: 3 },
				{ card: { ...outOfFaction, id: 'c', influenceCost: 5 }, quantity: 3 },
			],
		})
		expect(result.problems).toEqual([])
		expect(result.stats).toMatchObject({
			influenceSpent: 36,
			influenceLimit: null,
		})
	})

	test('global penalty lowers the limit; universal faction cost adds to every copy', () => {
		const penalty = filler(20, { title: 'Penalty Card' })
		const taxed = filler(21, { title: 'Taxed Card' })
		const result = evaluate({
			cards: [
				...corpCards(40, 20),
				{ card: penalty, quantity: 2 },
				{ card: taxed, quantity: 3 },
			],
			rules: rules({
				globalPenalty: ['penalty_card'],
				universalFactionCost: { taxed_card: 3 },
			}),
		})
		expect(result.stats).toMatchObject({
			influenceSpent: 9,
			influenceLimit: 13,
		})
		expect(result.perCard.taxed_card!.influence).toBe(9)
		expect(result.problems).toEqual([])

		const over = evaluate({
			cards: [
				...corpCards(39, 20),
				{ card: penalty, quantity: 3 },
				{ card: taxed, quantity: 3 },
			],
			rules: rules({
				globalPenalty: ['penalty_card'],
				universalFactionCost: { taxed_card: 5 },
			}),
		})
		expect(over.stats).toMatchObject({ influenceSpent: 15, influenceLimit: 12 })
		expect(over.problems).toEqual([
			{
				code: 'influence_limit',
				severity: 'error',
				message: '3 influence over the limit of 12',
			},
		])
	})
})

describe('identities', () => {
	const runner = { sideId: 'runner', factionId: 'shaper' } as const
	const professor = identity({
		...runner,
		id: 'the_professor_keeper_of_knowledge',
		title: 'The Professor: Keeper of Knowledge',
		influenceLimit: 1,
	})
	const corroder = card({
		title: 'Corroder',
		sideId: 'runner',
		factionId: 'anarch',
		typeId: 'program',
		influenceCost: 2,
	})
	const runnerFiller = (quantity: number, factionId = 'shaper') =>
		threeOfs(quantity, (n) => filler(n, { ...runner, factionId }))

	test('The Professor: the first copy of each program is free', () => {
		const one = evaluate({
			identity: professor,
			cards: [...runnerFiller(44), { card: corroder, quantity: 1 }],
		})
		expect(one.stats.influenceSpent).toBe(0)
		expect(one.problems).toEqual([])

		const three = evaluate({
			identity: professor,
			cards: [...runnerFiller(42), { card: corroder, quantity: 3 }],
		})
		expect(three.stats.influenceSpent).toBe(4)
		expect(three.perCard.corroder!.influence).toBe(4)
		expect(codes(three)).toEqual(['influence_limit'])

		// events aren't programs
		const event = card({ ...corroder, id: 'event', typeId: 'event' })
		expect(
			evaluate({
				identity: professor,
				cards: [...runnerFiller(44), { card: event, quantity: 1 }],
			}).stats.influenceSpent,
		).toBe(2)
	})

	const ampere = identity({
		id: 'ampere_cybernetics_for_anyone',
		title: 'Ampère: Cybernetics For Anyone',
		factionId: 'neutral_corp',
		influenceLimit: null,
	})
	const agendaFrom = (factionId: string, n: number) =>
		card({
			title: `${factionId} Agenda ${n}`,
			factionId,
			typeId: 'agenda',
			influenceCost: factionId === 'neutral_corp' ? 0 : null,
			agendaPoints: 2,
		})
	/** 45 singletons: `agendas`, then out-of-faction filler at 3 influence. */
	function ampereDeck(agendas: CardLite[]) {
		return [
			...agendas.map((a) => ({ card: a, quantity: 1 })),
			...Array.from({ length: 45 - agendas.length }, (_, n) => ({
				card: filler(n, { factionId: 'jinteki', influenceCost: 3 }),
				quantity: 1,
			})),
		]
	}
	// 2 from each Corp faction, plus 2 neutral: 10 agendas, 20 points
	const legalAgendas = [
		'haas_bioroid',
		'jinteki',
		'nbn',
		'weyland_consortium',
		'neutral_corp',
	].flatMap((f) => [agendaFrom(f, 1), agendaFrom(f, 2)])

	test('Ampère: 2 different agendas per faction, no influence limit', () => {
		const legal = evaluate({
			identity: ampere,
			cards: ampereDeck(legalAgendas),
		})
		expect(legal.problems).toEqual([])
		expect(legal.stats).toMatchObject({
			cardCount: 45,
			agendaPoints: 20,
			influenceSpent: 35 * 3,
			influenceLimit: null,
		})

		const threeNbn = evaluate({
			identity: ampere,
			cards: ampereDeck([
				...legalAgendas.filter((a) => a.factionId !== 'haas_bioroid'),
				agendaFrom('nbn', 3),
				agendaFrom('neutral_corp', 3),
			]),
		})
		expect(threeNbn.problems).toEqual([
			{
				code: 'ampere_agendas',
				severity: 'error',
				message: '3 different NBN agendas; Ampère can include 2',
			},
		])
	})

	test('Ampère: 1 copy of each card', () => {
		const deck = ampereDeck(legalAgendas)
		deck[10] = { ...deck[10]!, quantity: 2 }
		deck.pop()
		expect(evaluate({ identity: ampere, cards: deck }).problems).toEqual([
			{
				code: 'deck_limit',
				severity: 'error',
				cardId: 'filler_0',
				message: '2 copies of Filler 0; the limit is 1 with Ampère',
			},
		])
	})

	test('Nova: singleton', () => {
		const nova = identity({
			...runner,
			id: 'nova_initiumia_catalyst_impetus',
			title: 'Nova Initiumia: Catalyst & Impetus',
			factionId: 'neutral_runner',
			minimumDeckSize: 40,
			influenceLimit: null,
		})
		const singles = Array.from({ length: 40 }, (_, n) => ({
			card: filler(n, runner),
			quantity: 1,
		}))
		expect(evaluate({ identity: nova, cards: singles }).problems).toEqual([])
		const result = evaluate({
			identity: nova,
			cards: [...singles.slice(1), { card: filler(0, runner), quantity: 2 }],
		})
		expect(codes(result)).toEqual(['deck_limit'])
	})

	test('Custom Biotics can’t include Jinteki cards', () => {
		const customBiotics = identity({
			id: 'custom_biotics_engineered_for_success',
			title: 'Custom Biotics: Engineered for Success',
			influenceLimit: 22,
		})
		const result = evaluate({
			identity: customBiotics,
			cards: [
				...corpCards(44, 20),
				{
					card: card({
						title: 'Snare!',
						factionId: 'jinteki',
						influenceCost: 2,
					}),
					quantity: 1,
				},
			],
		})
		expect(result.problems).toEqual([
			{
				code: 'identity_restriction',
				severity: 'error',
				cardId: 'snare_',
				message: 'Custom Biotics can’t include Jinteki cards: Snare!',
			},
		])
	})

	test('Apex: a non-virtual resource is a warning (it can’t be installed)', () => {
		const apex = identity({
			...runner,
			id: 'apex_invasive_predator',
			title: 'Apex: Invasive Predator',
			factionId: 'apex',
			influenceLimit: 25,
		})
		const resource = (title: string, subtypes: string[]) =>
			card({
				title,
				...runner,
				factionId: 'apex',
				typeId: 'resource',
				subtypes,
			})
		const result = evaluate({
			identity: apex,
			cards: [
				...runnerFiller(43, 'apex'),
				{ card: resource('Virtual One', ['virtual']), quantity: 1 },
				{ card: resource('Physical One', ['job']), quantity: 1 },
			],
		})
		expect(result.problems).toEqual([
			{
				code: 'identity_restriction',
				severity: 'warning',
				cardId: 'physical_one',
				message: 'Apex can’t install non-virtual resources: Physical One',
			},
		])
		expect(result.isLegal).toBe(true)
	})

	test('Adam: 3 directives, outside the deck size', () => {
		const adam = identity({
			...runner,
			id: 'adam_compulsive_hacker',
			title: 'Adam: Compulsive Hacker',
			factionId: 'adam',
			influenceLimit: 25,
		})
		const directive = (title: string) =>
			card({
				title,
				...runner,
				factionId: 'adam',
				typeId: 'resource',
				subtypes: ['directive', 'virtual'],
				influenceCost: 3,
			})
		const directives = [
			'Always Be Running',
			'Find the Truth',
			'Neutralize All Threats',
		].map((title) => ({ card: directive(title), quantity: 1 }))
		const result = evaluate({
			identity: adam,
			cards: [...runnerFiller(45, 'adam'), ...directives],
		})
		expect(result.problems).toEqual([])
		expect(result.stats.cardCount).toBe(45)

		const short = evaluate({
			identity: adam,
			cards: [...runnerFiller(43, 'adam'), ...directives],
		})
		expect(codes(short)).toEqual(['deck_size'])

		const two = evaluate({
			identity: adam,
			cards: [
				...runnerFiller(45, 'adam'),
				directives[0]!,
				{ ...directives[1]!, quantity: 2 },
			],
		})
		expect(two.problems.map((p) => p.message)).toEqual([
			'Adam starts with 3 different directives; the deck has 2',
			'2 copies of Find the Truth; Adam starts with 1 of each directive',
		])

		// another Runner's directives are ordinary cards
		const anarch = identity({
			...runner,
			title: 'Anarch ID',
			factionId: 'anarch',
		})
		const splash = evaluate({
			identity: anarch,
			cards: [...runnerFiller(44, 'anarch'), directives[0]!],
		})
		expect(splash.problems).toEqual([])
		expect(splash.stats).toMatchObject({ cardCount: 45, influenceSpent: 3 })
	})
})

describe('alliance cards', () => {
	const jeeves = card({
		id: 'jeeves_model_bioroids',
		title: 'Jeeves Model Bioroids',
		typeId: 'asset',
		subtypes: ['alliance'],
		influenceCost: 3,
	})
	const nbn = identity({ title: 'NBN: Test ID', factionId: 'nbn' })
	const nbnDeck = (size: number) =>
		corpCards(size, 20).map((e) =>
			e.card.typeId === 'agenda'
				? { ...e, card: { ...e.card, factionId: 'nbn' } }
				: e,
		)

	test('Jeeves is free with 6 non-alliance HB cards', () => {
		const hb = (quantity: number) =>
			({ card: filler(90, { title: 'HB Card' }), quantity }) as const
		const nbnFiller = (size: number) =>
			nbnDeck(size).map((e) =>
				e.card.typeId === 'agenda'
					? e
					: { ...e, card: { ...e.card, factionId: 'nbn' } },
			)
		const with6 = evaluate({
			identity: nbn,
			cards: [
				...nbnFiller(36),
				{ card: jeeves, quantity: 3 },
				hb(3),
				{ card: filler(91, { title: 'HB Card 2' }), quantity: 3 },
			],
		})
		expect(with6.perCard.jeeves_model_bioroids!.influence).toBe(0)
		// the other 6 HB cards cost 1 each
		expect(with6.stats.influenceSpent).toBe(6)

		const with5 = evaluate({
			identity: nbn,
			cards: [
				...nbnFiller(37),
				{ card: jeeves, quantity: 3 },
				hb(3),
				{ card: filler(91, { title: 'HB Card 2' }), quantity: 2 },
			],
		})
		expect(with5.perCard.jeeves_model_bioroids!.influence).toBe(9)
	})

	test('Museum of History is free at 50 cards', () => {
		const museum = card({
			id: 'museum_of_history',
			title: 'Museum of History',
			factionId: 'neutral_corp',
			typeId: 'asset',
			subtypes: ['alliance'],
			influenceCost: 2,
		})
		const at = (size: number) =>
			evaluate({
				cards: [...corpCards(size - 3, 22), { card: museum, quantity: 3 }],
			})
		expect(at(49).perCard.museum_of_history!.influence).toBe(6)
		expect(at(50).perCard.museum_of_history!.influence).toBe(0)
	})

	test('Mumba Temple is free with 15 or fewer ice', () => {
		const mumba = card({
			id: 'mumba_temple',
			title: 'Mumba Temple',
			factionId: 'neutral_corp',
			typeId: 'asset',
			subtypes: ['alliance'],
			influenceCost: 2,
		})
		const withIce = (n: number) =>
			evaluate({
				cards: [
					...corpCards(45 - 2 - n, 20),
					{ card: mumba, quantity: 2 },
					...Array.from({ length: n }, (_, i) => ({
						card: filler(100 + i, { typeId: 'ice' }),
						quantity: 1,
					})),
				],
			})
		expect(withIce(15).perCard.mumba_temple!.influence).toBe(0)
		expect(withIce(16).perCard.mumba_temple!.influence).toBe(4)
	})
})

describe('deck structure', () => {
	test('deck limits', () => {
		const result = evaluate({
			cards: [...corpCards(41, 20), { card: filler(50), quantity: 4 }],
		})
		expect(result.problems).toEqual([
			{
				code: 'deck_limit',
				severity: 'error',
				cardId: 'filler_50',
				message: '4 copies of Filler 50; the limit is 3',
			},
		])
		const unique = filler(51, { deckLimit: 1 })
		expect(
			codes(
				evaluate({
					cards: [...corpCards(43, 20), { card: unique, quantity: 2 }],
				}),
			),
		).toEqual(['deck_limit'])
	})

	test('an identity among the cards', () => {
		const result = evaluate({
			cards: [
				...corpCards(45, 20),
				{ card: identity({ title: 'Other ID' }), quantity: 1 },
			],
		})
		expect(result.problems).toEqual([
			{
				code: 'identity_in_deck',
				severity: 'error',
				cardId: 'other_id',
				message:
					'Other ID is an identity; a deck has just one, chosen separately',
			},
		])
		// not counted as a card
		expect(result.stats.cardCount).toBe(45)
	})

	test('cards from the other side', () => {
		const result = evaluate({
			cards: [
				...corpCards(44, 20),
				{
					card: card({
						title: 'Sure Gamble',
						sideId: 'runner',
						factionId: 'neutral_runner',
						influenceCost: 0,
					}),
					quantity: 1,
				},
			],
		})
		expect(result.problems).toEqual([
			{
				code: 'wrong_side',
				severity: 'error',
				cardId: 'sure_gamble',
				message: 'Sure Gamble can’t go in a Corp deck',
			},
		])
	})

	test('no identity', () => {
		const result = evaluate({ identity: null })
		expect(result.problems).toEqual([
			{
				code: 'no_identity',
				severity: 'error',
				message: 'The deck needs an identity',
			},
		])
		expect(result.stats).toMatchObject({
			cardCount: 45,
			minDeckSize: null,
			influenceLimit: null,
			agendaPoints: 20,
		})
	})

	test('the same card listed twice counts once, with both quantities', () => {
		const result = evaluate({
			cards: [
				...corpCards(43, 20),
				{ card: filler(60), quantity: 2 },
				{ card: filler(60), quantity: 2 },
			],
		})
		expect(codes(result)).toEqual(['deck_limit'])
		expect(result.stats.cardCount).toBe(47)
	})
})

describe('format legality', () => {
	const rotated = filler(70, { title: 'Rotated', legalFormats: ['eternal'] })
	const banned = filler(71, { title: 'Bellona' })
	const restrictedA = filler(72, { title: 'Restricted A' })
	const restrictedB = filler(73, { title: 'Restricted B' })
	const standardRules = rules({
		banned: ['bellona'],
		restricted: ['restricted_a', 'restricted_b'],
	})

	test('rotated, banned and restricted cards', () => {
		const result = evaluate({
			cards: [
				...corpCards(40, 20),
				{ card: rotated, quantity: 1 },
				{ card: banned, quantity: 1 },
				{ card: restrictedA, quantity: 1 },
				{ card: restrictedB, quantity: 1 },
				{ card: filler(74), quantity: 1 },
			],
			rules: standardRules,
		})
		expect(result.problems).toEqual([
			{
				code: 'not_in_format',
				severity: 'error',
				cardId: 'rotated',
				message: 'Rotated isn’t legal in Standard',
			},
			{
				code: 'banned',
				severity: 'error',
				cardId: 'bellona',
				message: 'Bellona is banned in Standard',
			},
			{
				code: 'restricted',
				severity: 'error',
				cardId: 'restricted_a',
				message: 'Restricted A is 1 of 2 restricted cards; Standard allows 1',
			},
			{
				code: 'restricted',
				severity: 'error',
				cardId: 'restricted_b',
				message: 'Restricted B is 1 of 2 restricted cards; Standard allows 1',
			},
		])

		const warnings = evaluate({
			cards: [
				...corpCards(40, 20),
				{ card: rotated, quantity: 1 },
				{ card: banned, quantity: 1 },
				{ card: restrictedA, quantity: 1 },
				{ card: restrictedB, quantity: 1 },
				{ card: filler(74), quantity: 1 },
			],
			rules: standardRules,
			requireLegality: false,
		})
		expect(warnings.problems.map((p) => p.severity)).toEqual([
			'warning',
			'warning',
			'warning',
			'warning',
		])
		expect(warnings.isLegal).toBe(true)
	})

	test('one restricted card is fine', () => {
		expect(
			evaluate({
				cards: [...corpCards(44, 20), { card: restrictedA, quantity: 1 }],
				rules: standardRules,
			}).problems,
		).toEqual([])
	})

	test('Eternal points count once per card, up to the limit', () => {
		const eternalRules = rules({
			formatId: 'eternal',
			pointLimit: 7,
			points: { filler_80: 3, filler_81: 3, filler_82: 1, filler_83: 1 },
		})
		const cards = (n: number) => [
			...corpCards(45 - n * 3, 20),
			...[80, 81, 82, 83]
				.slice(0, n)
				.map((i) => ({ card: filler(i), quantity: 3 })),
		]
		const seven = evaluate({
			cards: cards(3),
			rules: eternalRules,
			formatId: 'eternal',
		})
		expect(seven.problems).toEqual([])
		expect(seven.stats).toMatchObject({ points: 7, pointLimit: 7 })

		const eight = evaluate({
			cards: cards(4),
			rules: eternalRules,
			formatId: 'eternal',
		})
		expect(eight.problems).toEqual([
			{
				code: 'points_limit',
				severity: 'error',
				message: '8 points; Eternal allows 7',
			},
		])
		expect(evaluate({ rules: rules({}) }).stats.points).toBeNull()
	})

	test('banned subtypes', () => {
		const current = filler(85, { title: 'A Current', subtypes: ['current'] })
		const result = evaluate({
			cards: [...corpCards(44, 20), { card: current, quantity: 1 }],
			rules: rules({ bannedSubtypes: ['current'] }),
		})
		expect(result.problems).toEqual([
			{
				code: 'banned_subtype',
				severity: 'error',
				cardId: 'a_current',
				message: 'A Current is banned in Standard (all current cards are)',
			},
		])
	})

	test('Startup caps agendas worth 3 or more points', () => {
		const three = (n: number) =>
			card({
				title: `Three Pointer ${n}`,
				typeId: 'agenda',
				influenceCost: null,
				agendaPoints: 3,
			})
		const cards = (copies: number) => [
			...corpCards(45 - copies, 20 - 3 * copies),
			...threeOfs(copies, three),
		]
		const startup = rules({ formatId: 'startup', maxThreePointAgendas: 4 })
		expect(
			evaluate({ cards: cards(4), rules: startup, formatId: 'startup' })
				.problems,
		).toEqual([])
		expect(
			evaluate({ cards: cards(5), rules: startup, formatId: 'startup' })
				.problems,
		).toEqual([
			{
				code: 'three_point_agendas',
				severity: 'error',
				message: '5 agendas worth 3 or more points; Startup allows 4',
			},
		])
	})

	test('the identity is checked too', () => {
		const result = evaluate({
			identity: { ...HB, legalFormats: ['eternal'] },
		})
		expect(result.problems).toEqual([
			{
				code: 'not_in_format',
				severity: 'error',
				cardId: HB.id,
				message: 'Haas-Bioroid: Test ID isn’t legal in Standard',
			},
		])
		expect(result.perCard[HB.id]!.problems).toHaveLength(1)
	})
})

describe('real decks', () => {
	test('a Standard deck from the current pool is legal', () => {
		const result = evaluateDeck(fromList(PRECISION_DESIGN))
		expect(result.problems).toEqual([])
		expect(result.isLegal).toBe(true)
		expect(result.stats).toEqual({
			cardCount: 45,
			minDeckSize: 40,
			influenceSpent: 9,
			influenceLimit: 15,
			agendaPoints: 20,
			agendaMin: 20,
			agendaMax: 21,
			points: null,
			pointLimit: null,
		})
		expect(result.perCard.anemone!.influence).toBe(4)
	})

	test('with a banned card: an error, or a warning when legality is optional', () => {
		const deck: DeckList = {
			...PRECISION_DESIGN,
			cards: PRECISION_DESIGN.cards.map(([id, quantity]) =>
				id === 'sprint' ? ['red_level_clearance', quantity] : [id, quantity],
			),
		}
		const banned = {
			code: 'banned',
			cardId: 'red_level_clearance',
			message: 'Red Level Clearance is banned in Standard',
		}
		expect(evaluateDeck(fromList(deck)).problems).toEqual([
			{ ...banned, severity: 'error' },
		])
		const casual = evaluateDeck(fromList(deck, { requireLegality: false }))
		expect(casual.problems).toEqual([{ ...banned, severity: 'warning' }])
		expect(casual.isLegal).toBe(true)
	})

	test('the same deck in Startup: cards outside its pool, and a ban', () => {
		const result = evaluateDeck(
			fromList(PRECISION_DESIGN, { formatId: 'startup', rules: STARTUP_RULES }),
		)
		expect(result.perCard.seamless_launch!.problems).toEqual([
			{
				code: 'banned',
				severity: 'error',
				cardId: 'seamless_launch',
				message: 'Seamless Launch is banned in Startup',
			},
		])
		expect(result.perCard.drafter!.problems.map((p) => p.message)).toEqual([
			'Drafter isn’t legal in Startup',
		])
		expect(result.perCard.hedge_fund!.problems).toEqual([])
	})

	test('the 2017 World Champion decks are legal in Eternal, rotated in Standard', () => {
		for (const [deck, stats] of [
			[
				WC_2017_CORP,
				{
					cardCount: 49,
					influenceSpent: 15,
					influenceLimit: 15,
					agendaPoints: 20,
					points: 6,
				},
			],
			[
				WC_2017_RUNNER,
				{
					cardCount: 45,
					influenceSpent: 15,
					influenceLimit: 15,
					agendaPoints: null,
					points: 0,
				},
			],
		] as const) {
			const eternal = evaluateDeck(
				fromList(deck, { formatId: 'eternal', rules: ETERNAL_RULES }),
			)
			expect(eternal.stats).toMatchObject(stats)
			expect(eternal.problems).toEqual([])
			const standard = evaluateDeck(fromList(deck))
			expect(standard.isLegal).toBe(false)
			expect(new Set(standard.problems.map((p) => p.code))).toEqual(
				new Set(['not_in_format']),
			)
		}
	})
})

test('deterministic, side-effect free and JSON-safe', () => {
	const input = fromList(PRECISION_DESIGN)
	const before = structuredClone(input)
	const first = evaluateDeck(input)
	expect(evaluateDeck(input)).toEqual(first)
	expect(input).toEqual(before)
	expect(JSON.parse(JSON.stringify(first))).toEqual(first)
})
