// Must stay first: configures zod before any route module builds a schema
import './utils/zod-config.ts'
import { OpenImgContextProvider } from 'openimg/react'
import {
	data,
	Link,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	type ShouldRevalidateFunction,
	useLoaderData,
	useLocation,
} from 'react-router'
import { HoneypotProvider } from 'remix-utils/honeypot/react'
import { type Route } from './+types/root.ts'
import appleTouchIconAssetUrl from './assets/favicons/apple-touch-icon.png'
import faviconAssetUrl from './assets/favicons/favicon.svg'
import { GeneralErrorBoundary } from './components/error-boundary.tsx'
import { EpicProgress } from './components/progress-bar.tsx'
import { useToast } from './components/toaster.tsx'
import { buttonVariants } from './components/ui/button.tsx'
import { EpicToaster } from './components/ui/sonner.tsx'
import { TooltipProvider } from './components/ui/tooltip.tsx'
import { UserDropdown } from './components/user-dropdown.tsx'
import {
	ThemeSwitch,
	useOptionalTheme,
	useTheme,
} from './routes/resources/theme-switch.tsx'
import tailwindStyleSheetUrl from './styles/tailwind.css?url'
import { getUserId, logout } from './utils/auth.server.ts'
import { ClientHintCheck, getHints } from './utils/client-hints.tsx'
import { prisma } from './utils/db.server.ts'
import { getEnv } from './utils/env.server.ts'
import { pipeHeaders } from './utils/headers.server.ts'
import { honeypot } from './utils/honeypot.server.ts'
import { combineHeaders, getDomainUrl, getImgSrc } from './utils/misc.tsx'
import { useNonce } from './utils/nonce-provider.ts'
import { type Theme, getTheme } from './utils/theme.server.ts'
import { makeTimings, time } from './utils/timing.server.ts'
import { getToast } from './utils/toast.server.ts'
import { useOptionalUser } from './utils/user.ts'

export const links: Route.LinksFunction = () => {
	return [
		{
			rel: 'icon',
			href: '/favicon.ico',
			sizes: '48x48',
		},
		{ rel: 'icon', type: 'image/svg+xml', href: faviconAssetUrl },
		{ rel: 'apple-touch-icon', href: appleTouchIconAssetUrl },
		{
			rel: 'manifest',
			href: '/site.webmanifest',
			crossOrigin: 'use-credentials',
		} as const, // necessary to make typescript happy
		{ rel: 'stylesheet', href: tailwindStyleSheetUrl },
	].filter(Boolean)
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
	return [
		{
			title: loaderData
				? 'Netrunner Collection'
				: 'Error | Netrunner Collection',
		},
		{
			name: 'description',
			content:
				'Track which Netrunner cards you own, down to the printing and alt art.',
		},
	]
}

export async function loader({ request, url }: Route.LoaderArgs) {
	const timings = makeTimings('root loader')
	const userId = await time(() => getUserId(request), {
		timings,
		type: 'getUserId',
		desc: 'getUserId in root',
	})

	const user = userId
		? await time(
				() =>
					prisma.user.findUnique({
						select: {
							id: true,
							name: true,
							username: true,
							image: { select: { objectKey: true } },
							roles: {
								select: {
									name: true,
									permissions: {
										select: { entity: true, action: true, access: true },
									},
								},
							},
						},
						where: { id: userId },
					}),
				{ timings, type: 'find user', desc: 'find user in root' },
			)
		: null
	if (userId && !user) {
		console.info('something weird happened')
		// something weird happened... The user is authenticated but we can't find
		// them in the database. Maybe they were deleted? Let's log them out.
		await logout({ request, redirectTo: '/' })
	}
	const { toast, headers: toastHeaders } = await getToast(request)
	const honeyProps = await honeypot.getInputProps()

	return data(
		{
			user,
			requestInfo: {
				hints: getHints(request),
				origin: getDomainUrl(request),
				path: url.pathname,
				userPrefs: {
					theme: getTheme(request),
				},
			},
			ENV: getEnv(),
			toast,
			honeyProps,
		},
		{
			headers: combineHeaders(
				{ 'Server-Timing': timings.toString() },
				toastHeaders,
			),
		},
	)
}

/**
 * Searching, filtering and paging only change the query string, and nothing
 * the root loader returns (user, theme, hints, toast, honeypot) depends on
 * it. Skip it on those GET navigations so they only run the page's loader.
 * Submissions, revalidations (same URL) and other pages revalidate as usual.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
	currentUrl,
	nextUrl,
	formMethod,
	defaultShouldRevalidate,
}) => {
	if (
		(!formMethod || formMethod === 'GET') &&
		currentUrl.pathname === nextUrl.pathname &&
		currentUrl.search !== nextUrl.search
	) {
		return false
	}
	return defaultShouldRevalidate
}

export const headers: Route.HeadersFunction = pipeHeaders

function Document({
	children,
	nonce,
	theme = 'light',
	env = {},
}: {
	children: React.ReactNode
	nonce: string
	theme?: Theme
	env?: Record<string, string | undefined>
}) {
	const allowIndexing = ENV.ALLOW_INDEXING !== 'false'
	return (
		<html lang="en" className={`${theme} h-full overflow-x-hidden`}>
			<head>
				<ClientHintCheck nonce={nonce} />
				<Meta />
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width,initial-scale=1" />
				{allowIndexing ? null : (
					<meta name="robots" content="noindex, nofollow" />
				)}
				<Links />
			</head>
			<body className="bg-background text-foreground">
				{children}
				<script
					nonce={nonce}
					dangerouslySetInnerHTML={{
						__html: `window.ENV = ${JSON.stringify(env)}`,
					}}
				/>
				<ScrollRestoration nonce={nonce} />
				<Scripts nonce={nonce} />
			</body>
		</html>
	)
}

export function Layout({ children }: { children: React.ReactNode }) {
	// if there was an error running the loader, data could be missing
	const data = useLoaderData<typeof loader | null>()
	const nonce = useNonce()
	const theme = useOptionalTheme()
	return (
		<Document nonce={nonce} theme={theme} env={data?.ENV}>
			{children}
		</Document>
	)
}

function App() {
	const data = useLoaderData<typeof loader>()
	const user = useOptionalUser()
	const theme = useTheme()
	const { pathname } = useLocation()
	useToast(data.toast)

	return (
		<OpenImgContextProvider
			optimizerEndpoint="/resources/images"
			getSrc={getImgSrc}
		>
			<TooltipProvider>
				{/* `isolate` keeps portaled Base UI popups stacking above the app */}
				<div className="isolate flex min-h-screen flex-col justify-between">
					<header className="container py-6">
						<nav className="flex items-center justify-between gap-4 md:gap-8">
							<Logo />
							<div className="flex items-center gap-3 sm:gap-6">
								{user ? (
									<>
										<Link
											to="/collection"
											prefetch="intent"
											className="font-semibold hover:underline"
										>
											Collection
										</Link>
										<Link
											to="/decks"
											prefetch="intent"
											className="font-semibold hover:underline"
										>
											Decks
										</Link>
										<DecklistsLink />
										<UserDropdown />
									</>
								) : (
									<>
										<DecklistsLink />
										{pathname === '/login' ? null : (
											<Link
												to="/login"
												className={buttonVariants({
													size: 'lg',
													variant:
														pathname === '/signup' ? 'default' : 'outline',
												})}
											>
												Log in
											</Link>
										)}
										{pathname === '/signup' ? null : (
											<Link
												to="/signup"
												className={buttonVariants({ size: 'lg' })}
											>
												Sign up
											</Link>
										)}
									</>
								)}
							</div>
						</nav>
					</header>

					<div className="flex flex-1 flex-col">
						<Outlet />
					</div>

					<footer className="container flex flex-wrap items-center justify-between gap-x-8 gap-y-4 pt-6 pb-5">
						<Logo />
						<nav
							aria-label="Footer"
							className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-2 text-sm max-sm:order-last max-sm:w-full"
						>
							{footerLinks.map(({ to, label }) => (
								<Link
									key={to}
									to={to}
									prefetch="intent"
									className="hover:text-foreground hover:underline"
								>
									{label}
								</Link>
							))}
						</nav>
						<ThemeSwitch userPreference={data.requestInfo.userPrefs.theme} />
					</footer>
				</div>
				<EpicToaster closeButton position="top-center" theme={theme} />
				<EpicProgress />
			</TooltipProvider>
		</OpenImgContextProvider>
	)
}

const footerLinks = [
	{ to: '/about', label: 'About' },
	{ to: '/support', label: 'Support' },
	{ to: '/privacy', label: 'Privacy' },
	{ to: '/tos', label: 'Terms' },
]

/** Everyone's public decks. Phones get there from the user menu or the decks pages. */
function DecklistsLink() {
	return (
		<Link
			to="/decklists"
			prefetch="intent"
			className="font-semibold hover:underline max-sm:hidden"
		>
			Decklists
		</Link>
	)
}

function Logo() {
	return (
		<Link to="/" className="group grid leading-snug">
			<span className="font-light transition group-hover:-translate-x-1">
				netrunner
			</span>
			<span className="font-bold transition group-hover:translate-x-1">
				collection
			</span>
		</Link>
	)
}

function AppWithProviders() {
	const data = useLoaderData<typeof loader>()
	return (
		<HoneypotProvider {...data.honeyProps}>
			<App />
		</HoneypotProvider>
	)
}

export default AppWithProviders

// this is a last resort error boundary. There's not much useful information we
// can offer at this level.
export const ErrorBoundary = GeneralErrorBoundary
