import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ComingSoon } from '#app/components/mtg/coming-soon.tsx'
import { requireCollectionView } from '#app/utils/collection-loaders.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { canEdit, basePath, ownerName } = await requireCollectionView(
		request,
		params.username,
		'mtg',
	)
	return { access: { canEdit, basePath, ownerName } }
}

export const meta: Route.MetaFunction = () => [
	{ title: 'MTG sets | Netrunner Collection' },
]

export default function SharedMtgCollectionSetsIndexRoute({
	loaderData,
}: Route.ComponentProps) {
	return (
		<ComingSoon title={'MTG sets'} collection={loaderData.access}>
			Set progress for the Magic collection shared with you.
		</ComingSoon>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
