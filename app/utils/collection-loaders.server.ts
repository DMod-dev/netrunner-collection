import { invariantResponse } from '@epic-web/invariant'
import { redirect } from 'react-router'
import { type CollectionAccessInfo } from '#app/components/collection-access-context.tsx'
import { requireCollectionAccess } from './collection-access.server.ts'
import {
	type CardSearchParams,
	getCardCount,
	getCollectionTotals,
	getFilterOptions,
	getSetCompletion,
	getSetsProgress,
	parseCompletionTarget,
	searchCards,
} from './collection.server.ts'
import { getCopiesInUse } from './deck-fill.server.ts'

/**
 * The loaders behind the Cards, Sets and Set pages. Each page is mounted
 * twice: at /collection for your own collection, and at
 * /users/:username/collection for one shared with you.
 */
export type CollectionView = CollectionAccessInfo & { ownerId: string }

/**
 * Whose collection to load. Without `ownerUsername` it's the caller's own.
 * The owner visiting their own shared URL is sent to the same page under
 * /collection, so there's only one editable copy of each page.
 */
export async function requireCollectionView(
	request: Request,
	ownerUsername?: string,
): Promise<CollectionView> {
	const access = await requireCollectionAccess(request, ownerUsername)
	if (ownerUsername !== undefined && access.canEdit) {
		const url = new URL(request.url)
		const path = url.pathname.replace(
			/^\/users\/[^/]+\/collection/,
			'/collection',
		)
		throw redirect(`${path}${url.search}`)
	}
	return {
		ownerId: access.ownerId,
		canEdit: access.canEdit,
		basePath: access.canEdit
			? '/collection'
			: `/users/${access.owner.username}/collection`,
		ownerName: access.canEdit
			? 'You'
			: (access.owner.name ?? access.owner.username),
	}
}

/** What the page components need to know about whose collection it is. */
function accessInfo({ canEdit, basePath, ownerName }: CollectionView) {
	return { canEdit, basePath, ownerName } satisfies CollectionAccessInfo
}

export async function loadCardsPage(request: Request, view: CollectionView) {
	const url = new URL(request.url)
	const get = (key: string) => url.searchParams.get(key) || undefined
	const owned = get('owned')
	const params: CardSearchParams = {
		q: get('q'),
		sides: url.searchParams.getAll('side').filter(Boolean),
		factions: url.searchParams.getAll('faction').filter(Boolean),
		type: get('type'),
		set: get('set'),
		format: get('format'),
		owned: owned === 'owned' || owned === 'missing' ? owned : undefined,
		page: Number(get('page')) || 1,
	}

	const [results, filters, totals, cardCount] = await Promise.all([
		searchCards(view.ownerId, params, { includeNotes: view.canEdit }),
		getFilterOptions(),
		getCollectionTotals(view.ownerId),
		getCardCount(),
	])
	// decks are private, so only your own collection shows what they hold
	const inUse = view.canEdit
		? await getCopiesInUse(
				view.ownerId,
				results.cards.map((c) => c.id),
			)
		: new Map<string, number>()
	return {
		...results,
		inUse: Object.fromEntries(inUse),
		filters,
		totals,
		cardCount,
		access: accessInfo(view),
	}
}

export type CardsPageData = Awaited<ReturnType<typeof loadCardsPage>>

export async function loadSetsPage(request: Request, view: CollectionView) {
	const target = parseCompletionTarget(
		new URL(request.url).searchParams.get('target'),
	)
	const cycles = await getSetsProgress(view.ownerId, target)
	return { target, cycles, access: accessInfo(view) }
}

export type SetsPageData = Awaited<ReturnType<typeof loadSetsPage>>

export async function loadSetPage(
	request: Request,
	view: CollectionView,
	setId: string,
) {
	const target = parseCompletionTarget(
		new URL(request.url).searchParams.get('target'),
	)
	const set = await getSetCompletion(view.ownerId, setId, target, {
		includeNotes: view.canEdit,
	})
	invariantResponse(set, 'Set not found', { status: 404 })
	return { target, set, access: accessInfo(view) }
}

export type SetPageData = Awaited<ReturnType<typeof loadSetPage>>
