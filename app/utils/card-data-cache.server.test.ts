import { expect, test } from 'vitest'
import {
	cachedUntilNextMtgSync,
	cachedUntilNextSync,
} from './card-data-cache.server.ts'
import { prisma } from './db.server.ts'

test('builds every time without a recorded sync, once per sync afterwards', async () => {
	let builds = 0
	const build = async () => ++builds
	expect(await cachedUntilNextSync('test:value', build)).toBe(1)
	expect(await cachedUntilNextSync('test:value', build)).toBe(2)

	await prisma.nrdbSync.create({
		data: {
			status: 'success',
			finishedAt: new Date(),
			startedAt: new Date(Date.now() - Math.random() * 1e9),
		},
	})
	expect(await cachedUntilNextSync('test:value', build)).toBe(3)
	expect(await cachedUntilNextSync('test:value', build)).toBe(3)
	// concurrent callers share one build
	const [a, b] = await Promise.all([
		cachedUntilNextSync('test:other', build),
		cachedUntilNextSync('test:other', build),
	])
	expect(a).toBe(4)
	expect(b).toBe(4)

	await prisma.nrdbSync.create({
		data: { status: 'success', finishedAt: new Date(), startedAt: new Date() },
	})
	expect(await cachedUntilNextSync('test:value', build)).toBe(5)
})

test('MTG values are cached until Scryfall data changes, not per run', async () => {
	let builds = 0
	const build = async () => ++builds
	expect(await cachedUntilNextMtgSync('test:mtg', build)).toBe(1)
	expect(await cachedUntilNextMtgSync('test:mtg', build)).toBe(2)

	const bulkUpdatedAt = new Date(Date.now() - Math.random() * 1e9)
	await prisma.mtgSync.create({
		data: {
			status: 'success',
			bulkUpdatedAt,
			startedAt: new Date(Date.now() - 60_000),
		},
	})
	expect(await cachedUntilNextMtgSync('test:mtg', build)).toBe(3)
	// a later run that found the same file keeps the value
	await prisma.mtgSync.create({
		data: { status: 'success', bulkUpdatedAt, startedAt: new Date() },
	})
	expect(await cachedUntilNextMtgSync('test:mtg', build)).toBe(3)
	// a Netrunner sync doesn't touch MTG values
	await prisma.nrdbSync.create({
		data: { status: 'success', finishedAt: new Date(), startedAt: new Date() },
	})
	expect(await cachedUntilNextMtgSync('test:mtg', build)).toBe(3)

	await prisma.mtgSync.create({
		data: {
			status: 'success',
			bulkUpdatedAt: new Date(bulkUpdatedAt.getTime() + 1000),
			startedAt: new Date(Date.now() + 1000),
		},
	})
	expect(await cachedUntilNextMtgSync('test:mtg', build)).toBe(4)
})
