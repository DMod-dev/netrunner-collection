import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { SetsPage } from '#app/components/collection-pages/sets.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import {
	loadSetsPage,
	requireCollectionView,
} from '#app/utils/collection-loaders.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const view = await requireCollectionView(request, params.username)
	return loadSetsPage(request, view)
}

export const meta: Route.MetaFunction = ({ loaderData }) => [
	{
		title: `${loaderData ? `${loaderData.access.ownerName}’s set completion` : 'Set completion'} | Netrunner Collection`,
	},
]

export default function SharedSetsRoute({ loaderData }: Route.ComponentProps) {
	return <SetsPage loaderData={loaderData} />
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
