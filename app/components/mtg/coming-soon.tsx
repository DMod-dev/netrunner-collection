import { type ReactNode } from 'react'
import {
	type CollectionAccessInfo,
	CollectionAccessProvider,
} from '#app/components/collection-access-context.tsx'
import { CollectionNav } from '#app/components/collection-ui.tsx'

/**
 * A page of the MTG side that isn't built yet. It has its real URL, title and
 * navigation, so the game switcher and links already work; the roadmap in
 * issue #74 fills them in.
 */
export function ComingSoon({
	title,
	children,
	collection,
}: {
	title: string
	/** What the page will do. */
	children: ReactNode
	/** For a collection page: whose it is, so its tabs show. */
	collection?: CollectionAccessInfo
}) {
	const content = (
		<main className="container mb-24 flex flex-col gap-6">
			{collection ? <CollectionNav /> : null}
			<h1 className="text-h2">{title}</h1>
			<div className="bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
				<h2 className="font-semibold">Coming soon</h2>
				<p className="text-muted-foreground max-w-prose text-sm">{children}</p>
			</div>
		</main>
	)
	return collection ? (
		<CollectionAccessProvider value={collection}>
			{content}
		</CollectionAccessProvider>
	) : (
		content
	)
}
