import { expect, test } from 'vitest'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	BASE_URL,
	convertSetCookieToCookie,
	getSessionCookieHeader,
} from '#tests/utils.ts'
import { validateRequest } from './verify.server.ts'

async function insertUserWithTwoFA() {
	const user = await prisma.user.create({
		select: { id: true },
		data: createUser(),
	})
	const { otp, ...config } = await generateTOTP()
	await prisma.verification.create({
		data: { type: twoFAVerificationType, target: user.id, ...config },
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
	})
	return { ...user, otp, session }
}

/** The cookie `/login` leaves behind when the account has 2FA. */
async function pendingLoginCookie(sessionId: string) {
	const verifySession = await verifySessionStorage.getSession()
	verifySession.set('unverified-session-id', sessionId)
	return convertSetCookieToCookie(
		await verifySessionStorage.commitSession(verifySession),
	)
}

function verify(cookie: string, target: string, code: string) {
	const body = new URLSearchParams({
		code,
		type: twoFAVerificationType,
		target,
		redirectTo: '/',
	})
	const request = new Request(new URL('/verify', BASE_URL), {
		method: 'POST',
		headers: { cookie },
	})
	return validateRequest(request, body).catch((e: unknown) => e)
}

test('a 2FA code logs in the pending session of its own user', async () => {
	const victim = await insertUserWithTwoFA()
	const response = await verify(
		await pendingLoginCookie(victim.session.id),
		victim.id,
		victim.otp,
	)
	expect(response).toHaveRedirect('/')
	await expect(response).toHaveSessionForUser(victim.id)
})

test("someone else's 2FA code can't finish a login", async () => {
	const victim = await insertUserWithTwoFA()
	const attacker = await insertUserWithTwoFA()
	// the attacker knows the victim's password, so /login gave them the
	// victim's pending session, but only their own authenticator
	const response = await verify(
		await pendingLoginCookie(victim.session.id),
		attacker.id,
		attacker.otp,
	)
	expect(response).toHaveRedirect('/login')
	expect((response as Response).headers.get('set-cookie') ?? '').not.toContain(
		'en_session',
	)
})

test("someone else's 2FA code doesn't re-verify a signed-in session", async () => {
	const victim = await insertUserWithTwoFA()
	const attacker = await insertUserWithTwoFA()
	// e.g. with a stolen session cookie, before disabling the victim's 2FA
	const response = await verify(
		await getSessionCookieHeader(victim.session),
		attacker.id,
		attacker.otp,
	)
	expect(response).toHaveRedirect('/login')
})
