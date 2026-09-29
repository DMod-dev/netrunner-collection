import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ComingSoon } from '#app/components/mtg/coming-soon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { type Route } from './+types/scan.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	return null
}

export const meta: Route.MetaFunction = () => [
	{ title: 'Scan MTG cards | Netrunner Collection' },
]

export default function MtgScanRoute() {
	return (
		<ComingSoon title={'Scan MTG cards'}>
			Add cards to your collection by pointing your camera at them.
		</ComingSoon>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
