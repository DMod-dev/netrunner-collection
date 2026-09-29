import { expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	isMtgSyncRunning,
	type ScryfallSyncSummary,
} from '#app/utils/scryfall.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { insertMtgCards } from '#tests/mtg-db.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './scryfall-sync.tsx'

async function requestAs(role: 'admin' | 'user', method = 'GET') {
	const user = await prisma.user.create({
		select: { id: true },
		data: {
			...createUser(),
			...(role === 'admin' ? { roles: { connect: { name: 'admin' } } } : {}),
		},
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId: user.id },
	})
	return new Request('http://localhost/admin/scryfall-sync', {
		method,
		headers: { cookie: await getSessionCookieHeader(session) },
	})
}

const summary: ScryfallSyncSummary = {
	bulkUpdatedAt: '2026-09-29T09:05:55.334Z',
	skipped: false,
	sets: 1053,
	cards: 37836,
	printings: 109271,
	cardsWritten: 12,
	printingsWritten: 4321,
	digitalSkipped: 9135,
	printingsDeleted: 2,
	cardsDeleted: 0,
	printingsKept: 1,
	deletionsSkipped: false,
	durationMs: 12_345,
}

test('admins see the MTG counts and what each sync did', async () => {
	await insertMtgCards()
	await prisma.mtgSync.create({
		data: {
			status: 'success',
			trigger: 'schedule',
			startedAt: new Date('2026-09-29T10:00:00Z'),
			bulkUpdatedAt: new Date(summary.bulkUpdatedAt),
			summary: JSON.stringify(summary),
		},
	})
	await prisma.mtgSync.create({
		data: {
			status: 'success',
			trigger: 'schedule',
			startedAt: new Date('2026-09-29T22:00:00Z'),
			bulkUpdatedAt: new Date(summary.bulkUpdatedAt),
			summary: JSON.stringify({ ...summary, skipped: true, durationMs: 700 }),
		},
	})

	const data = await loader({
		request: await requestAs('admin'),
	} as Parameters<typeof loader>[0])

	expect(data.counts).toEqual({ cards: 31, printings: 32, sets: 15 })
	expect(data.fileUpdatedAt).toEqual(new Date(summary.bulkUpdatedAt))
	expect(data.history.map((sync) => sync.details)).toEqual([
		"Scryfall's file hadn't changed (0.7s)",
		expect.stringMatching(
			/^37,836 cards, 109,271 printings, 1,053 sets, 4,321 printings changed, 2 removed, 1 gone but kept \(in use\) in 12\.3s$/,
		),
	])
})

test('only admins can see or start the sync', async () => {
	await expect(
		loader({ request: await requestAs('user') } as Parameters<
			typeof loader
		>[0]),
	).rejects.toMatchObject({ init: { status: 403 } })
	await expect(
		action({ request: await requestAs('user', 'POST') } as Parameters<
			typeof action
		>[0]),
	).rejects.toMatchObject({ init: { status: 403 } })
	expect(await prisma.mtgSync.count()).toBe(0)
})

test('"Sync now" starts one manual sync', async () => {
	vi.spyOn(console, 'error').mockImplementation(() => {})
	// hold Scryfall's responses until a second click has been tried
	let openGate!: () => void
	const gate = new Promise<void>((resolve) => (openGate = resolve))
	vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
		await gate
		return new Response('down', { status: 503, statusText: 'Unavailable' })
	})

	const first = await action({
		request: await requestAs('admin', 'POST'),
	} as Parameters<typeof action>[0])
	const second = await action({
		request: await requestAs('admin', 'POST'),
	} as Parameters<typeof action>[0])
	expect(first).toEqual({ started: true })
	expect(second).toEqual({ started: false })

	openGate()
	await vi.waitFor(async () => {
		expect(await isMtgSyncRunning()).toBe(false)
	})
	expect(await prisma.mtgSync.findFirstOrThrow()).toMatchObject({
		status: 'error',
		trigger: 'manual',
	})
})
