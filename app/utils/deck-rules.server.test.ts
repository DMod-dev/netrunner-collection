import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { getFormatRules, toCardLite } from './deck-rules.server.ts'

test('the rules come from the format’s active list', async () => {
	await prisma.format.create({
		data: {
			id: 'eternal',
			name: 'Eternal',
			activeRestrictionId: 'eternal_points_list_26_03',
		},
	})
	// an older list for the same format is ignored
	await prisma.restriction.create({
		data: {
			id: 'eternal_points_list_25_09',
			name: 'Eternal Points List 25.09',
			formatId: 'eternal',
			pointLimit: 7,
			verdicts: {
				create: { cardId: 'old_card', verdict: 'points', value: 3 },
			},
		},
	})
	await prisma.restriction.create({
		data: {
			id: 'eternal_points_list_26_03',
			name: 'Eternal Points List 26.03',
			formatId: 'eternal',
			pointLimit: 7,
			bannedSubtypes: ',current,',
			verdicts: {
				create: [
					{ cardId: 'hostile_takeover', verdict: 'points', value: 2 },
					{ cardId: 'banned_card', verdict: 'banned' },
					{ cardId: 'restricted_card', verdict: 'restricted' },
					{ cardId: 'penalty_card', verdict: 'global_penalty' },
					{
						cardId: 'engineering_the_future',
						verdict: 'universal_faction_cost',
						value: 3,
					},
				],
			},
		},
	})

	expect(await getFormatRules('eternal')).toEqual({
		formatId: 'eternal',
		restrictionId: 'eternal_points_list_26_03',
		restrictionName: 'Eternal Points List 26.03',
		banned: ['banned_card'],
		restricted: ['restricted_card'],
		points: { hostile_takeover: 2 },
		pointLimit: 7,
		globalPenalty: ['penalty_card'],
		universalFactionCost: { engineering_the_future: 3 },
		bannedSubtypes: ['current'],
		maxThreePointAgendas: null,
	})
})

test('a format with no list has empty rules; an unknown one has none', async () => {
	await prisma.format.create({ data: { id: 'startup', name: 'Startup' } })

	expect(await getFormatRules('startup')).toMatchObject({
		formatId: 'startup',
		restrictionId: null,
		banned: [],
		pointLimit: null,
		maxThreePointAgendas: null,
	})
	expect(await getFormatRules('nope')).toBeNull()
})

test('Startup’s 3-point agenda cap comes from the known lists', async () => {
	await prisma.format.create({
		data: {
			id: 'startup',
			name: 'Startup',
			activeRestrictionId: 'startup_balance_update_26_05',
		},
	})
	await prisma.restriction.create({
		data: {
			id: 'startup_balance_update_26_05',
			name: 'Startup Balance Update 26.05',
			formatId: 'startup',
			verdicts: { create: { cardId: 'cleaver', verdict: 'banned' } },
		},
	})

	expect(await getFormatRules('startup')).toMatchObject({
		banned: ['cleaver'],
		maxThreePointAgendas: 4,
	})
})

test('toCardLite splits the stored id lists', () => {
	expect(
		toCardLite({
			id: 'mumba_temple',
			title: 'Mumba Temple',
			sideId: 'corp',
			factionId: 'neutral_corp',
			typeId: 'asset',
			subtypes: ',alliance,facility,',
			deckLimit: 3,
			influenceCost: 2,
			agendaPoints: null,
			minimumDeckSize: null,
			influenceLimit: null,
			legalFormats: ',eternal,',
		}),
	).toMatchObject({
		subtypes: ['alliance', 'facility'],
		legalFormats: ['eternal'],
	})
	expect(
		toCardLite({
			id: 'x',
			title: 'X',
			sideId: 'corp',
			factionId: 'nbn',
			typeId: 'asset',
			subtypes: ',',
			deckLimit: 3,
			influenceCost: 1,
			agendaPoints: null,
			minimumDeckSize: null,
			influenceLimit: null,
			legalFormats: ',',
		}),
	).toMatchObject({ subtypes: [], legalFormats: [] })
})
