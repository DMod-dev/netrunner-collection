import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'
import { createPassword, createUser } from '#tests/db-utils.ts'
import { server } from '#tests/mocks/index.ts'
import { consoleWarn } from '#tests/setup/setup-test-env.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import {
	checkIsCommonPassword,
	getPasswordHashParts,
	getSessionExpirationDate,
	resetUserPassword,
	signOutOtherSessions,
} from './auth.server.ts'
import { prisma } from './db.server.ts'

test('checkIsCommonPassword returns true when password is found in breach database', async () => {
	const password = 'testpassword'
	const [prefix, suffix] = getPasswordHashParts(password)

	server.use(
		http.get(`https://api.pwnedpasswords.com/range/${prefix}`, () => {
			// Include the actual suffix in the response with another realistic suffix
			return new HttpResponse(
				`1234567890123456789012345678901234A:1\n${suffix}:1234`,
				{ status: 200 },
			)
		}),
	)

	const result = await checkIsCommonPassword(password)
	expect(result).toBe(true)
})

test('checkIsCommonPassword returns false when password is not found in breach database', async () => {
	const password = 'sup3r-dup3r-s3cret'
	const [prefix] = getPasswordHashParts(password)

	server.use(
		http.get(`https://api.pwnedpasswords.com/range/${prefix}`, () => {
			// Response with realistic suffixes that won't match
			return new HttpResponse(
				'1234567890123456789012345678901234A:1\n' +
					'1234567890123456789012345678901234B:2',
				{ status: 200 },
			)
		}),
	)

	const result = await checkIsCommonPassword(password)
	expect(result).toBe(false)
})

// Error cases
test('checkIsCommonPassword returns false when API returns 500', async () => {
	const password = 'testpassword'
	const [prefix] = getPasswordHashParts(password)

	server.use(
		http.get(`https://api.pwnedpasswords.com/range/${prefix}`, () => {
			return new HttpResponse(null, { status: 500 })
		}),
	)

	const result = await checkIsCommonPassword(password)
	expect(result).toBe(false)
})

test('checkIsCommonPassword returns false when response has invalid format', async () => {
	consoleWarn.mockImplementation(() => {})
	const password = 'testpassword'
	const [prefix] = getPasswordHashParts(password)

	server.use(
		http.get(
			`https://api.pwnedpasswords.com/range/${prefix}`,
			() => new Response(),
		),
	)
	// MSW rebuilds the mocked Response before fetch resolves, so stub text() on
	// the prototype to make the parsing throw a TypeError
	vi.spyOn(Response.prototype, 'text').mockResolvedValue(
		null as unknown as string,
	)

	const result = await checkIsCommonPassword(password)
	expect(result).toBe(false)
	expect(consoleWarn).toHaveBeenCalledWith(
		'Unknown error during password check',
		expect.any(TypeError),
	)
})

describe('timeout handling', () => {
	// normally we'd use fake timers for a test like this, but there's an issue
	// with AbortSignal.timeout() and fake timers: https://github.com/sinonjs/fake-timers/issues/418
	// beforeEach(() => vi.useFakeTimers())
	// afterEach(() => vi.useRealTimers())

	test('checkIsCommonPassword times out after 1 second', async () => {
		consoleWarn.mockImplementation(() => {})
		server.use(
			http.get('https://api.pwnedpasswords.com/range/:prefix', async () => {
				const twoSecondDelay = 2000
				await new Promise((resolve) => setTimeout(resolve, twoSecondDelay))
				// swap to this when we can use fake timers:
				// await vi.advanceTimersByTimeAsync(twoSecondDelay)
				return new HttpResponse(
					'1234567890123456789012345678901234A:1\n' +
						'1234567890123456789012345678901234B:2',
					{ status: 200 },
				)
			}),
		)

		const result = await checkIsCommonPassword('testpassword')
		expect(result).toBe(false)
		expect(consoleWarn).toHaveBeenCalledWith('Password check timed out')
	})
})

async function insertUserWithSessions(count: number) {
	const user = await prisma.user.create({
		select: { id: true, username: true },
		data: { ...createUser(), password: { create: createPassword() } },
	})
	const sessions = await Promise.all(
		Array.from({ length: count }, () =>
			prisma.session.create({
				select: { id: true },
				data: { userId: user.id, expirationDate: getSessionExpirationDate() },
			}),
		),
	)
	return { ...user, sessions }
}

test('resetting a password signs the account out everywhere', async () => {
	const user = await insertUserWithSessions(2)
	await resetUserPassword({ username: user.username, password: 'new-pass' })
	expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
})

test('signOutOtherSessions keeps only the current session', async () => {
	const user = await insertUserWithSessions(3)
	const other = await insertUserWithSessions(1)
	const current = user.sessions[0]!
	const request = new Request('https://example.com', {
		headers: { cookie: await getSessionCookieHeader(current) },
	})
	await signOutOtherSessions(request, user.id)
	expect(
		await prisma.session.findMany({
			where: { userId: user.id },
			select: { id: true },
		}),
	).toEqual([current])
	// nobody else's sessions are touched
	expect(await prisma.session.count({ where: { userId: other.id } })).toBe(1)
})
