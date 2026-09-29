import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ComingSoon } from '#app/components/mtg/coming-soon.tsx'
import { requireCollectionView } from '#app/utils/collection-loaders.server.ts'
import { type Route } from './+types/$setId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	const { canEdit, basePath, ownerName } = await requireCollectionView(
		request,
		undefined,
		'mtg',
	)
	return { access: { canEdit, basePath, ownerName } }
}

export const meta: Route.MetaFunction = () => [
	{ title: 'MTG set | Netrunner Collection' },
]

export default function MtgCollectionSetsSetidRoute({
	loaderData,
}: Route.ComponentProps) {
	return (
		<ComingSoon title={'MTG set'} collection={loaderData.access}>
			Every card in the set, with what you own and what you’re missing.
		</ComingSoon>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
