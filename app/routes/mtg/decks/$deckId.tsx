import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { type Route } from './+types/$deckId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

// there are no MTG decks until the deck builder (#61)
export function loader(_: Route.LoaderArgs) {
	throw new Response('Deck not found', { status: 404 })
}

export const meta: Route.MetaFunction = () => [
	{ title: 'MTG deck | Netrunner Collection' },
]

export default function MtgDeckRoute() {
	return null
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{ 404: () => <p>No MTG deck with that id.</p> }}
		/>
	)
}
