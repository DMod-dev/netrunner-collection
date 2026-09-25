import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { pruneExpiredAuthRecords } from './auth-prune.server.ts'
import { prisma } from './db.server.ts'

test('expired sessions and verifications are pruned, live ones kept', async () => {
	const now = new Date('2026-09-25T12:00:00Z')
	const before = new Date(now.getTime() - 1000)
	const after = new Date(now.getTime() + 1000)
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	await prisma.session.createMany({
		data: [
			{ id: 'expired', userId: user.id, expirationDate: before },
			{ id: 'live', userId: user.id, expirationDate: after },
		],
	})
	const verification = {
		type: 'onboarding',
		secret: 'secret',
		algorithm: 'SHA-256',
		digits: 6,
		period: 600,
		charSet: '0123456789',
	}
	await prisma.verification.createMany({
		data: [
			{ ...verification, target: 'expired@example.com', expiresAt: before },
			{ ...verification, target: 'live@example.com', expiresAt: after },
			{ ...verification, target: 'forever@example.com', expiresAt: null },
		],
	})

	await expect(pruneExpiredAuthRecords(now)).resolves.toEqual({
		sessions: 1,
		verifications: 1,
	})

	const sessions = await prisma.session.findMany({ select: { id: true } })
	expect(sessions.map((s) => s.id)).toEqual(['live'])
	const targets = await prisma.verification.findMany({
		select: { target: true },
		orderBy: { target: 'asc' },
	})
	expect(targets.map((v) => v.target)).toEqual([
		'forever@example.com',
		'live@example.com',
	])
})
