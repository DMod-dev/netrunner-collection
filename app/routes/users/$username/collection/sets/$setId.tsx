import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { type ShouldRevalidateFunctionArgs } from 'react-router'
import {
	SetPage,
	setPageShouldRevalidate,
} from '#app/components/collection-pages/set.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import {
	loadSetPage,
	requireCollectionView,
} from '#app/utils/collection-loaders.server.ts'
import { type Route } from './+types/$setId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const view = await requireCollectionView(request, params.username)
	return loadSetPage(request, view, params.setId)
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
	return setPageShouldRevalidate(args)
}

export const meta: Route.MetaFunction = ({ loaderData }) => [
	{
		title: `${loaderData ? `${loaderData.set.name} · ${loaderData.access.ownerName}’s collection` : 'Set'} | Netrunner Collection`,
	},
]

export default function SharedSetRoute({ loaderData }: Route.ComponentProps) {
	return <SetPage loaderData={loaderData} />
}

export function ErrorBoundary() {
	// a missing set and a collection that isn't shared are both 404s; the
	// message says which
	return <GeneralErrorBoundary />
}
