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

export const meta: Route.MetaFunction = ({ loaderData }) => [
	{
		title: `${loaderData ? `${loaderData.access.ownerName}’s MTG collection` : 'MTG collection'} | Netrunner Collection`,
	},
]

export default function SharedMtgCollectionIndexRoute({
	loaderData,
}: Route.ComponentProps) {
	return (
		<ComingSoon
			title={`${loaderData.access.ownerName}’s MTG collection`}
			collection={loaderData.access}
		>
			The Magic cards shared with you, read-only.
		</ComingSoon>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
