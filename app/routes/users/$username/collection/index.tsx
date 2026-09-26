import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { CardsPage } from '#app/components/collection-pages/cards.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import {
	loadCardsPage,
	requireCollectionView,
} from '#app/utils/collection-loaders.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const view = await requireCollectionView(request, params.username)
	return loadCardsPage(request, view)
}

export const meta: Route.MetaFunction = ({ loaderData }) => [
	{
		title: `${loaderData ? `${loaderData.access.ownerName}’s collection` : 'Collection'} | Netrunner Collection`,
	},
]

export default function SharedCollectionRoute({
	loaderData,
}: Route.ComponentProps) {
	return <CardsPage loaderData={loaderData} />
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
