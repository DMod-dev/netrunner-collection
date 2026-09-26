import { data } from 'react-router'
import { getCollectionTotals } from './collection.server.ts'
import { prisma } from './db.server.ts'
import { createToastHeaders } from './toast.server.ts'

/**
 * Granting and revoking CollectionShare rows. Whether a share lets someone see
 * a collection is decided in `collection-access.server.ts`; this file only
 * manages the rows.
 */

const userSelect = { id: true, username: true, name: true } as const

export type AddShareResult =
	| { status: 'added'; viewer: { id: string; username: string } }
	| { status: 'error'; message: string }

/**
 * Share `ownerId`'s collection with the user called `username`. Sharing with
 * yourself, with nobody, or with someone who already has access is an error
 * and creates nothing.
 */
export async function addShareByUsername(
	ownerId: string,
	username: string,
): Promise<AddShareResult> {
	const viewer = await prisma.user.findUnique({
		where: { username: username.toLowerCase() },
		select: { id: true, username: true },
	})
	if (!viewer) {
		return { status: 'error', message: 'No user with that username' }
	}
	if (viewer.id === ownerId) {
		return { status: 'error', message: 'That’s you' }
	}
	try {
		await prisma.collectionShare.create({
			data: { ownerId, viewerId: viewer.id },
			select: { id: true },
		})
	} catch (error) {
		// the (ownerId, viewerId) unique index, also covering a double submit
		if (isUniqueConstraintError(error)) {
			return { status: 'error', message: 'Already shared with this user' }
		}
		throw error
	}
	return { status: 'added', viewer }
}

function isUniqueConstraintError(error: unknown) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'P2002'
	)
}

/**
 * Delete a share that `userId` is either side of: the owner revoking it or the
 * viewer leaving it. A share between two other users is left alone. Returns
 * the deleted share, or null if there was nothing to delete.
 */
export async function removeShare(userId: string, shareId: string) {
	const share = await prisma.collectionShare.findFirst({
		where: { id: shareId, OR: [{ ownerId: userId }, { viewerId: userId }] },
		select: {
			id: true,
			owner: { select: userSelect },
			viewer: { select: userSelect },
		},
	})
	if (!share) return null
	// deleteMany, so removing twice at once doesn't throw
	await prisma.collectionShare.deleteMany({ where: { id: share.id } })
	return share
}

/**
 * The `remove-share` intent, shared by the owner's Sharing settings and the
 * viewer's Shared with me page.
 */
export async function removeShareAction(userId: string, formData: FormData) {
	const shareId = formData.get('shareId')
	const share =
		typeof shareId === 'string' ? await removeShare(userId, shareId) : null
	if (!share) {
		return data({ status: 'error' } as const, {
			status: 404,
			headers: await createToastHeaders({
				type: 'error',
				title: 'Could not remove share',
				description: 'That share no longer exists.',
			}),
		})
	}
	const description =
		share.owner.id === userId
			? `${displayName(share.viewer)} can no longer see your collection.`
			: `You can no longer see ${displayName(share.owner)}’s collection.`
	return data({ status: 'success' } as const, {
		headers: await createToastHeaders({
			type: 'success',
			title: 'Share removed',
			description,
		}),
	})
}

function displayName(user: { username: string; name: string | null }) {
	return user.name ?? user.username
}

/** Who can see `ownerId`'s collection, oldest share first. */
export async function listSharesGiven(ownerId: string) {
	return prisma.collectionShare.findMany({
		where: { ownerId },
		orderBy: { createdAt: 'asc' },
		select: { id: true, createdAt: true, viewer: { select: userSelect } },
	})
}

/** Collections shared with `viewerId`, oldest share first, with their size. */
export async function listSharesReceived(viewerId: string) {
	const shares = await prisma.collectionShare.findMany({
		where: { viewerId },
		orderBy: { createdAt: 'asc' },
		select: { id: true, createdAt: true, owner: { select: userSelect } },
	})
	return Promise.all(
		shares.map(async (share) => ({
			...share,
			totals: await getCollectionTotals(share.owner.id),
		})),
	)
}
