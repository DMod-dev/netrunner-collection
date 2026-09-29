import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ComingSoon } from '#app/components/mtg/coming-soon.tsx'
import { requireCollectionView } from '#app/utils/collection-loaders.server.ts'
import { type Route } from './+types/import-export.ts'

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
	{ title: 'Import/Export MTG | Netrunner Collection' },
]

export default function MtgCollectionImportExportRoute({
	loaderData,
}: Route.ComponentProps) {
	return (
		<ComingSoon title={'Import/Export MTG'} collection={loaderData.access}>
			Import your collection from ManaBox or Archidekt, and export it as CSV or
			JSON.
		</ComingSoon>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
