import { expect, test } from 'vitest'
import { groupByType } from './deck.ts'

const entry = (title: string, typeId: string, typeName: string) => ({
	card: { title, typeId, typeName },
	quantity: 1,
})

test('groupByType puts a runner deck in event, resource, program, hardware order', () => {
	const groups = groupByType(
		[
			entry('Mayday', 'hardware', 'Hardware'),
			entry('Corroder', 'program', 'Program'),
			entry('Diesel', 'event', 'Event'),
			entry('Daily Casts', 'resource', 'Resource'),
		],
		'runner',
	)
	expect(groups.map((g) => g.name)).toEqual([
		'Event',
		'Resource',
		'Program',
		'Hardware',
	])
})

test('groupByType puts a corp deck in agenda, operation, asset, upgrade, ice order', () => {
	const groups = groupByType(
		[
			entry('Ice Wall', 'ice', 'Ice'),
			entry('Manegarm Skunkworks', 'upgrade', 'Upgrade'),
			entry('PAD Campaign', 'asset', 'Asset'),
			entry('Hedge Fund', 'operation', 'Operation'),
			entry('Hostile Takeover', 'agenda', 'Agenda'),
		],
		'corp',
	)
	expect(groups.map((g) => g.name)).toEqual([
		'Agenda',
		'Operation',
		'Asset',
		'Upgrade',
		'Ice',
	])
})
