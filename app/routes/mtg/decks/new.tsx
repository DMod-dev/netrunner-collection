import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ComingSoon } from '#app/components/mtg/coming-soon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { type Route } from './+types/new.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	return null
}

export const meta: Route.MetaFunction = () => [
	{ title: 'New MTG deck | Netrunner Collection' },
]

export default function MtgDecksNewRoute() {
	return (
		<ComingSoon title={'New MTG deck'}>
			Start a deck from a commander, a format or an imported list.
		</ComingSoon>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
