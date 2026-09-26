import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { parseSetCookieHeader } from '#tests/utils.ts'
import { getSessionExpirationDate, sessionKey } from './auth.server.ts'
import {
	getCollectionAccess,
	requireCollectionAccess,
} from './collection-access.server.ts'
import { prisma } from './db.server.ts'
import { authSessionStorage } from './session.server.ts'

async function insertUser(roles: Array<string> = ['user']) {
	return prisma.user.create({
		select: { id: true, username: true, name: true },
		data: {
			...createUser(),
			roles: { connect: roles.map((name) => ({ name })) },
		},
	})
}

async function signedInRequest(userId: string) {
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId },
	})
	const authSession = await authSessionStorage.getSession()
	authSession.set(sessionKey, session.id)
	const parsedCookie = parseSetCookieHeader(
		await authSessionStorage.commitSession(authSession),
	)
	const cookie = new URLSearchParams({
		[parsedCookie.name]: parsedCookie.value,
	}).toString()
	return new Request('http://localhost/collection', { headers: { cookie } })
}

async function expect404(promise: Promise<unknown>) {
	const thrown = await promise.catch((error: unknown) => error)
	expect(thrown).toBeInstanceOf(Response)
	expect((thrown as Response).status).toBe(404)
	expect(await (thrown as Response).text()).toBe(
		'No collection shared with you',
	)
}

test('your own collection is editable, with or without your username', async () => {
	const me = await insertUser()
	const request = await signedInRequest(me.id)

	const expected = { viewerId: me.id, ownerId: me.id, owner: me, canEdit: true }
	expect(await requireCollectionAccess(request)).toEqual(expected)
	expect(await requireCollectionAccess(request, me.username)).toEqual(expected)
	expect(await getCollectionAccess(request, me.username)).toEqual(expected)
})

test('an unknown username is a 404', async () => {
	const me = await insertUser()
	const request = await signedInRequest(me.id)

	await expect404(requireCollectionAccess(request, 'nobody-by-this-name'))
	expect(await getCollectionAccess(request, 'nobody-by-this-name')).toBeNull()
})

test('another user without a share is a 404', async () => {
	const me = await insertUser()
	const other = await insertUser()
	const request = await signedInRequest(me.id)

	await expect404(requireCollectionAccess(request, other.username))
	expect(await getCollectionAccess(request, other.username)).toBeNull()
})

test('a share gives read-only access until it is deleted', async () => {
	const me = await insertUser()
	const owner = await insertUser()
	const share = await prisma.collectionShare.create({
		data: { ownerId: owner.id, viewerId: me.id },
	})
	const request = await signedInRequest(me.id)

	const access = await requireCollectionAccess(request, owner.username)
	expect(access).toEqual({
		viewerId: me.id,
		ownerId: owner.id,
		owner,
		canEdit: false,
	})
	expect(await getCollectionAccess(request, owner.username)).toEqual(access)

	// a share only works one way
	const ownerRequest = await signedInRequest(owner.id)
	await expect404(requireCollectionAccess(ownerRequest, me.username))

	await prisma.collectionShare.delete({ where: { id: share.id } })
	await expect404(requireCollectionAccess(request, owner.username))
})

test('admins get no implicit access', async () => {
	const admin = await insertUser(['admin', 'user'])
	const other = await insertUser()
	const request = await signedInRequest(admin.id)

	await expect404(requireCollectionAccess(request, other.username))
	expect(await getCollectionAccess(request, other.username)).toBeNull()
})

test('anonymous requests are sent to login', async () => {
	const other = await insertUser()
	const request = new Request('http://localhost/collection')

	const thrown = await requireCollectionAccess(request, other.username).catch(
		(error: unknown) => error,
	)
	expect(thrown).toBeInstanceOf(Response)
	expect((thrown as Response).status).toBe(302)
	expect((thrown as Response).headers.get('location')).toBe(
		`/login?${new URLSearchParams({ redirectTo: '/collection' })}`,
	)
})

test('deleting a user removes the shares they own or receive', async () => {
	const owner = await insertUser()
	const viewer = await insertUser()
	await prisma.collectionShare.create({
		data: { ownerId: owner.id, viewerId: viewer.id },
	})
	await prisma.collectionShare.create({
		data: { ownerId: viewer.id, viewerId: owner.id },
	})

	await prisma.user.delete({ where: { id: owner.id } })

	expect(
		await prisma.collectionShare.count({ where: { viewerId: viewer.id } }),
	).toBe(0)
	expect(await prisma.collectionShare.count()).toBe(0)
})

test('there is only one share per owner and viewer', async () => {
	const owner = await insertUser()
	const viewer = await insertUser()
	const share = { ownerId: owner.id, viewerId: viewer.id }
	await prisma.collectionShare.create({ data: share })

	await expect(
		prisma.collectionShare.create({ data: share }),
	).rejects.toMatchObject({ code: 'P2002' })
})
