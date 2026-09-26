import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import {
	addShareByUsername,
	listSharesGiven,
	listSharesReceived,
	removeShare,
	removeShareAction,
} from './collection-share.server.ts'
import { prisma } from './db.server.ts'

async function insertUser() {
	return prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
}

async function shareCount() {
	return prisma.collectionShare.count()
}

test('sharing by username creates one grant, whatever the case', async () => {
	const owner = await insertUser()
	const viewer = await insertUser()

	expect(
		await addShareByUsername(owner.id, viewer.username.toUpperCase()),
	).toEqual({
		status: 'added',
		viewer: { id: viewer.id, username: viewer.username },
	})
	expect(
		await prisma.collectionShare.findMany({
			select: { ownerId: true, viewerId: true },
		}),
	).toEqual([{ ownerId: owner.id, viewerId: viewer.id }])
})

test('sharing with yourself, nobody or someone twice creates nothing', async () => {
	const owner = await insertUser()
	const viewer = await insertUser()
	await addShareByUsername(owner.id, viewer.username)

	expect(await addShareByUsername(owner.id, owner.username)).toEqual({
		status: 'error',
		message: 'That’s you',
	})
	expect(await addShareByUsername(owner.id, 'nobody_here')).toEqual({
		status: 'error',
		message: 'No user with that username',
	})
	expect(await addShareByUsername(owner.id, viewer.username)).toEqual({
		status: 'error',
		message: 'Already shared with this user',
	})
	expect(await shareCount()).toBe(1)
})

test('either side can remove a share, nobody else can', async () => {
	const owner = await insertUser()
	const viewer = await insertUser()
	const stranger = await insertUser()
	const share = () =>
		prisma.collectionShare.create({
			select: { id: true },
			data: { ownerId: owner.id, viewerId: viewer.id },
		})

	const first = await share()
	expect(await removeShare(stranger.id, first.id)).toBeNull()
	expect(await shareCount()).toBe(1)
	expect(await removeShare(owner.id, first.id)).toMatchObject({
		id: first.id,
		viewer: { id: viewer.id },
	})
	expect(await shareCount()).toBe(0)
	// already gone
	expect(await removeShare(owner.id, first.id)).toBeNull()

	const second = await share()
	expect(await removeShare(viewer.id, second.id)).toMatchObject({
		id: second.id,
		owner: { id: owner.id },
	})
	expect(await shareCount()).toBe(0)
})

test('the remove action is a 404 for a share that isn’t yours', async () => {
	const owner = await insertUser()
	const viewer = await insertUser()
	const stranger = await insertUser()
	const { id } = await prisma.collectionShare.create({
		select: { id: true },
		data: { ownerId: owner.id, viewerId: viewer.id },
	})
	const formData = new FormData()
	formData.set('shareId', id)

	const denied = await removeShareAction(stranger.id, formData)
	expect(denied.init?.status).toBe(404)
	expect(denied.data).toEqual({ status: 'error' })
	expect(await shareCount()).toBe(1)

	const removed = await removeShareAction(viewer.id, formData)
	expect(removed.data).toEqual({ status: 'success' })
	expect(await shareCount()).toBe(0)
})

test('the lists show each side of a share', async () => {
	const owner = await insertUser()
	const first = await insertUser()
	const second = await insertUser()
	await addShareByUsername(owner.id, first.username)
	await addShareByUsername(owner.id, second.username)

	const given = await listSharesGiven(owner.id)
	// both made in the same instant, so either order
	expect(given.map((share) => share.viewer)).toHaveLength(2)
	expect(given.map((share) => share.viewer)).toEqual(
		expect.arrayContaining([first, second]),
	)
	const shareWithFirst = given.find((share) => share.viewer.id === first.id)

	expect(await listSharesReceived(first.id)).toEqual([
		{
			id: shareWithFirst!.id,
			createdAt: expect.any(Date),
			owner,
			totals: { copies: 0, ownedCards: 0 },
		},
	])
	expect(await listSharesGiven(first.id)).toEqual([])
	expect(await listSharesReceived(owner.id)).toEqual([])
})
