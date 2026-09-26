import { type ReactNode } from 'react'

/** Layout for the About / Support / Privacy / Terms pages. */
export function MarketingPage({
	title,
	lead,
	children,
}: {
	title: string
	lead?: ReactNode
	children: ReactNode
}) {
	return (
		<main className="container max-w-2xl py-10 sm:py-16">
			<h1 className="text-h1">{title}</h1>
			{lead ? (
				<p className="text-muted-foreground mt-4 text-lg">{lead}</p>
			) : null}
			<div className="text-body-sm [&_a]:text-foreground mt-8 flex flex-col gap-4 leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
				{children}
			</div>
		</main>
	)
}

export function ExternalLink({
	href,
	children,
}: {
	href: string
	children: ReactNode
}) {
	return (
		<a href={href} target="_blank" rel="noreferrer">
			{children}
		</a>
	)
}
