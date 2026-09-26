import { expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import {
	isAutoSyncEnabled,
	isSyncRunning,
	NRDB_USER_AGENT,
	SYNC_EVERY_MS,
	syncFromNrdb,
	syncIfDue,
} from './nrdb.server.ts'

async function waitForSyncToFinish() {
	// wait on both the "running" row and the in-process flag
	await vi.waitFor(async () => {
		expect(await isSyncRunning()).toBe(false)
	})
}

test('syncIfDue waits a day between successful syncs', async () => {
	const now = Date.now()
	await prisma.nrdbSync.create({
		data: {
			status: 'success',
			trigger: 'schedule',
			startedAt: new Date(now - SYNC_EVERY_MS + 60_000),
		},
	})
	expect(await syncIfDue({ now })).toBe(false)
	expect(await prisma.nrdbSync.count()).toBe(1)
})

test('syncIfDue starts one scheduled sync when due and records failures', async () => {
	vi.spyOn(console, 'error').mockImplementation(() => {})
	// hold NRDB's responses until we've checked a second sync can't start
	let openGate!: () => void
	const gate = new Promise<void>((resolve) => (openGate = resolve))
	const fetchSpy = vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation(async () => {
			await gate
			return new Response('down', { status: 503, statusText: 'Unavailable' })
		})
	await prisma.nrdbSync.create({
		data: {
			status: 'success',
			startedAt: new Date(Date.now() - SYNC_EVERY_MS - 60_000),
		},
	})

	const [first, second] = await Promise.all([syncIfDue(), syncIfDue()])
	// exactly one of the two calls starts the sync
	expect([first, second].filter(Boolean)).toHaveLength(1)
	expect(await isSyncRunning()).toBe(true)

	openGate()
	await waitForSyncToFinish()
	expect(await isSyncRunning()).toBe(false)

	const latest = await prisma.nrdbSync.findFirstOrThrow({
		orderBy: { startedAt: 'desc' },
	})
	expect(latest).toMatchObject({ status: 'error', trigger: 'schedule' })
	expect(latest.error).toMatch(/503/)
	// NRDB can see who's calling
	expect(fetchSpy).toHaveBeenCalledWith(
		expect.stringContaining('api.netrunnerdb.com'),
		expect.objectContaining({
			headers: expect.objectContaining({ 'user-agent': NRDB_USER_AGENT }),
		}),
	)
})

test('isSyncRunning clears syncs interrupted by a restart', async () => {
	await prisma.nrdbSync.create({
		data: { status: 'running', startedAt: new Date(Date.now() - 60 * 60_000) },
	})
	expect(await isSyncRunning()).toBe(false)
	expect(await prisma.nrdbSync.findFirstOrThrow()).toMatchObject({
		status: 'error',
		error: 'Interrupted before it finished',
	})

	await prisma.nrdbSync.create({ data: { status: 'running' } })
	expect(await isSyncRunning()).toBe(true)
})

test('auto sync is off with mocks, in tests, or when disabled', () => {
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('MOCKS', '')
	vi.stubEnv('NRDB_AUTO_SYNC', '')
	expect(isAutoSyncEnabled()).toBe(true)
	vi.stubEnv('NRDB_AUTO_SYNC', 'false')
	expect(isAutoSyncEnabled()).toBe(false)
	vi.stubEnv('NRDB_AUTO_SYNC', '')
	vi.stubEnv('MOCKS', 'true')
	expect(isAutoSyncEnabled()).toBe(false)
	vi.stubEnv('MOCKS', '')
	vi.stubEnv('NODE_ENV', 'test')
	expect(isAutoSyncEnabled()).toBe(false)
})

type Resource = { id: string; attributes: Record<string, unknown> }

/** Serve `resources` from a mocked NetrunnerDB, one page per resource type. */
function mockNrdb(resources: Record<string, Array<Resource>>) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = new URL(input instanceof Request ? input.url : input)
		const type = url.pathname.split('/').at(-1)!
		const data = resources[type]
		if (!data) return new Response('not found', { status: 404 })
		return Response.json({
			data: data.map((r) => ({ ...r, type })),
			links: { next: null },
		})
	})
}

function card(id: string, attributes: Record<string, unknown>): Resource {
	return {
		id,
		attributes: {
			title: id,
			stripped_title: id,
			side_id: 'corp',
			faction_id: 'haas_bioroid',
			card_type_id: 'agenda',
			text: null,
			stripped_text: null,
			display_subtypes: null,
			is_unique: false,
			deck_limit: 3,
			cost: null,
			influence_cost: null,
			card_pool_ids: ['standard_26_03'],
			...attributes,
		},
	}
}

function nrdbData({
	standardBans = ['banned_card', 'hostile_takeover'],
}: { standardBans?: Array<string> } = {}) {
	return {
		factions: [
			{
				id: 'haas_bioroid',
				attributes: { name: 'Haas-Bioroid', side_id: 'corp', is_mini: false },
			},
		],
		card_types: [
			{ id: 'identity', attributes: { name: 'Identity' } },
			{ id: 'agenda', attributes: { name: 'Agenda' } },
		],
		formats: [
			{
				id: 'standard',
				attributes: {
					name: 'Standard',
					active_card_pool_id: 'standard_26_03',
					active_snapshot_id: 'standard_26_03',
					active_restriction_id: 'standard_ban_list_26_03',
				},
			},
			{
				id: 'eternal',
				attributes: {
					name: 'Eternal',
					active_card_pool_id: 'eternal_26_03',
					active_snapshot_id: 'eternal_26_03',
					active_restriction_id: 'eternal_points_list_26_03',
				},
			},
		],
		restrictions: [
			{
				id: 'standard_ban_list_26_03',
				attributes: {
					name: 'Standard Ban List 26.03',
					format_id: 'standard',
					date_start: '2026-03-01',
					point_limit: null,
					banned_subtypes: [],
					verdicts: {
						banned: standardBans,
						restricted: [],
						universal_faction_cost: { engineering_the_future: 3 },
						global_penalty: [],
						points: {},
					},
				},
			},
			{
				id: 'eternal_points_list_26_03',
				attributes: {
					name: 'Eternal Points List 26.03',
					format_id: 'eternal',
					date_start: '2026-03-01',
					point_limit: 7,
					banned_subtypes: ['current'],
					verdicts: { points: { hostile_takeover: 2, banned_card: 1 } },
				},
			},
			// a list for a format NRDB doesn't list is skipped
			{
				id: 'mystery_list',
				attributes: {
					name: 'Mystery',
					format_id: 'mystery',
					date_start: null,
					point_limit: null,
					verdicts: { banned: ['hostile_takeover'] },
				},
			},
		],
		card_cycles: [
			{
				id: 'sg',
				attributes: {
					name: 'System Gateway',
					position: 1,
					date_release: null,
					released_by: null,
				},
			},
		],
		card_sets: [
			{
				id: 'sg',
				attributes: {
					name: 'System Gateway',
					position: 1,
					size: 3,
					card_cycle_id: 'sg',
					card_set_type_id: 'core',
					date_release: null,
					released_by: null,
				},
			},
		],
		cards: [
			card('the_professor', {
				side_id: 'runner',
				card_type_id: 'identity',
				minimum_deck_size: 45,
				influence_limit: 1,
				card_subtype_ids: ['cyborg', 'natural'],
			}),
			card('ampere', {
				card_type_id: 'identity',
				minimum_deck_size: 44,
				influence_limit: null,
				card_subtype_ids: ['bioroid'],
			}),
			card('hostile_takeover', {
				agenda_points: 1,
				card_subtype_ids: ['expansion'],
			}),
			// no subtypes at all
			card('banned_card', { agenda_points: 2 }),
		],
		printings: [],
	}
}

test('syncs identity stats, subtypes, formats and ban/points lists', async () => {
	mockNrdb(nrdbData())

	const summary = await syncFromNrdb()
	expect(summary).toMatchObject({ cards: 4, formats: 2, restrictions: 2 })

	expect(
		await prisma.card.findMany({
			orderBy: { id: 'asc' },
			select: {
				id: true,
				minimumDeckSize: true,
				influenceLimit: true,
				agendaPoints: true,
				subtypes: true,
			},
		}),
	).toEqual([
		{
			id: 'ampere',
			minimumDeckSize: 44,
			influenceLimit: null,
			agendaPoints: null,
			subtypes: ',bioroid,',
		},
		{
			id: 'banned_card',
			minimumDeckSize: null,
			influenceLimit: null,
			agendaPoints: 2,
			subtypes: ',',
		},
		{
			id: 'hostile_takeover',
			minimumDeckSize: null,
			influenceLimit: null,
			agendaPoints: 1,
			subtypes: ',expansion,',
		},
		{
			id: 'the_professor',
			minimumDeckSize: 45,
			influenceLimit: 1,
			agendaPoints: null,
			subtypes: ',cyborg,natural,',
		},
	])

	expect(
		await prisma.format.findMany({
			orderBy: { id: 'asc' },
			select: { id: true, activeRestrictionId: true },
		}),
	).toEqual([
		{ id: 'eternal', activeRestrictionId: 'eternal_points_list_26_03' },
		{ id: 'standard', activeRestrictionId: 'standard_ban_list_26_03' },
	])
	expect(
		await prisma.restriction.findUniqueOrThrow({
			where: { id: 'eternal_points_list_26_03' },
			select: { formatId: true, pointLimit: true, bannedSubtypes: true },
		}),
	).toEqual({ formatId: 'eternal', pointLimit: 7, bannedSubtypes: ',current,' })
	expect(
		await prisma.restriction.count({ where: { id: 'mystery_list' } }),
	).toBe(0)

	const verdicts = () =>
		prisma.restrictionVerdict.findMany({
			orderBy: [{ restrictionId: 'asc' }, { cardId: 'asc' }],
			select: { restrictionId: true, cardId: true, verdict: true, value: true },
		})
	const expected = [
		{
			restrictionId: 'eternal_points_list_26_03',
			cardId: 'banned_card',
			verdict: 'points',
			value: 1,
		},
		{
			restrictionId: 'eternal_points_list_26_03',
			cardId: 'hostile_takeover',
			verdict: 'points',
			value: 2,
		},
		{
			restrictionId: 'standard_ban_list_26_03',
			cardId: 'banned_card',
			verdict: 'banned',
			value: null,
		},
		{
			restrictionId: 'standard_ban_list_26_03',
			cardId: 'engineering_the_future',
			verdict: 'universal_faction_cost',
			value: 3,
		},
		{
			restrictionId: 'standard_ban_list_26_03',
			cardId: 'hostile_takeover',
			verdict: 'banned',
			value: null,
		},
	]
	expect(await verdicts()).toEqual(expected)

	// syncing again changes nothing
	await syncFromNrdb()
	expect(await verdicts()).toEqual(expected)
})

test('a card taken off a list, or a list NRDB drops, loses its verdicts', async () => {
	const fetchSpy = mockNrdb(nrdbData())
	await syncFromNrdb()

	const shrunk = nrdbData({ standardBans: ['banned_card'] })
	shrunk.restrictions = shrunk.restrictions.filter(
		(r) => r.id !== 'eternal_points_list_26_03',
	)
	fetchSpy.mockRestore()
	mockNrdb(shrunk)
	const summary = await syncFromNrdb()
	expect(summary.restrictions).toBe(1)

	expect(
		await prisma.restrictionVerdict.findMany({
			orderBy: { cardId: 'asc' },
			select: { restrictionId: true, cardId: true, verdict: true },
		}),
	).toEqual([
		{
			restrictionId: 'standard_ban_list_26_03',
			cardId: 'banned_card',
			verdict: 'banned',
		},
		{
			restrictionId: 'standard_ban_list_26_03',
			cardId: 'engineering_the_future',
			verdict: 'universal_faction_cost',
		},
	])
	expect(await prisma.restriction.findMany({ select: { id: true } })).toEqual([
		{ id: 'standard_ban_list_26_03' },
	])
})
