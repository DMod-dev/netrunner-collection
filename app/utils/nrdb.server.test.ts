import { afterEach, expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import {
	isAutoSyncEnabled,
	isSyncRunning,
	NRDB_USER_AGENT,
	SYNC_EVERY_MS,
	syncIfDue,
} from './nrdb.server.ts'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

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
	expect([first, second].sort()).toEqual([false, true])
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
