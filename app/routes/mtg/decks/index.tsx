import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ComingSoon } from '#app/components/mtg/coming-soon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	return null
}

export const meta: Route.MetaFunction = () => [
	{ title: 'My MTG decks | Netrunner Collection' },
]

export default function MtgDecksIndexRoute() {
	return (
		<ComingSoon title={'My MTG decks'}>
			Build Commander and other decks, and fill them from your collection.
		</ComingSoon>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
