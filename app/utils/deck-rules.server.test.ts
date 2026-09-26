import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { getFormatRules } from './deck-rules.server.ts'

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
		banned: new Set(['banned_card']),
		restricted: new Set(['restricted_card']),
		points: new Map([['hostile_takeover', 2]]),
		pointLimit: 7,
		globalPenalty: new Set(['penalty_card']),
		universalFactionCost: new Map([['engineering_the_future', 3]]),
		bannedSubtypes: new Set(['current']),
	})
})

test('a format with no list has empty rules; an unknown one has none', async () => {
	await prisma.format.create({ data: { id: 'startup', name: 'Startup' } })

	expect(await getFormatRules('startup')).toMatchObject({
		formatId: 'startup',
		restrictionId: null,
		banned: new Set(),
		pointLimit: null,
	})
	expect(await getFormatRules('nope')).toBeNull()
})
