import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ComingSoon } from '#app/components/mtg/coming-soon.tsx'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => [
	{ title: 'MTG decklists | Netrunner Collection' },
]

export default function MtgDecklistsIndexRoute() {
	return (
		<ComingSoon title={'MTG decklists'}>
			Browse everyone’s public Magic decks.
		</ComingSoon>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
