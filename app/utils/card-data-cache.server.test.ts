import { expect, test } from 'vitest'
import { cachedUntilNextSync } from './card-data-cache.server.ts'
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
