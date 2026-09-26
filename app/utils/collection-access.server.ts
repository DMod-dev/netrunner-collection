import { requireUserId } from './auth.server.ts'
import { prisma } from './db.server.ts'

export type CollectionAccess = {
	viewerId: string
	ownerId: string
	owner: { id: string; username: string; name: string | null }
	canEdit: boolean
}

const ownerSelect = { id: true, username: true, name: true } as const

/**
 * Whose collection is being shown and whether the caller may edit it. Every
 * collection loader/action goes through here. Without `ownerUsername` (or with
 * the caller's own) it's the caller's collection. Anonymous requests are sent
 * to /login; an unknown user or a collection that isn't shared with the caller
 * is a 404.
 */
export async function requireCollectionAccess(
	request: Request,
	ownerUsername?: string,
): Promise<CollectionAccess> {
	const access = await resolveCollectionAccess(request, ownerUsername)
	if (!access) {
		// 404 rather than 403, so the response doesn't confirm that the user
		// exists or that anyone else has access.
		throw new Response('No collection shared with you', { status: 404 })
	}
	return access
}

/**
 * Same checks as `requireCollectionAccess`, but returns null instead of
 * throwing a 404. For deciding whether to show a link or button.
 */
export async function getCollectionAccess(
	request: Request,
	ownerUsername: string,
): Promise<CollectionAccess | null> {
	return resolveCollectionAccess(request, ownerUsername)
}

async function resolveCollectionAccess(
	request: Request,
	ownerUsername?: string,
): Promise<CollectionAccess | null> {
	const viewerId = await requireUserId(request)

	if (!ownerUsername) {
		const owner = await prisma.user.findUniqueOrThrow({
			where: { id: viewerId },
			select: ownerSelect,
		})
		return { viewerId, ownerId: viewerId, owner, canEdit: true }
	}

	const owner = await prisma.user.findUnique({
		where: { username: ownerUsername },
		select: ownerSelect,
	})
	if (!owner) return null
	if (owner.id === viewerId) {
		return { viewerId, ownerId: viewerId, owner, canEdit: true }
	}

	// Admins get no implicit access: only an explicit grant counts. Link tokens
	// (`OR link token valid`) or public visibility
	// (`OR owner.collectionVisibility === 'public'`) would be extra branches here.
	const share = await prisma.collectionShare.findUnique({
		where: { ownerId_viewerId: { ownerId: owner.id, viewerId } },
		select: { id: true },
	})
	if (!share) return null

	return { viewerId, ownerId: owner.id, owner, canEdit: false }
}
