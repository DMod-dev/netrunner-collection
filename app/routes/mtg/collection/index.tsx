import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ComingSoon } from '#app/components/mtg/coming-soon.tsx'
import { requireCollectionView } from '#app/utils/collection-loaders.server.ts'
import { type Route } from './+types/index.ts'

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
	{ title: 'My MTG collection | Netrunner Collection' },
]

export default function MtgCollectionIndexRoute({
	loaderData,
}: Route.ComponentProps) {
	return (
		<ComingSoon title={'My MTG collection'} collection={loaderData.access}>
			Search every Magic card and printing, and record how many you own of each,
			by finish, condition and language.
		</ComingSoon>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
