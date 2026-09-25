import { startTransition, useEffect } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'

if (ENV.MODE === 'production' && ENV.SENTRY_DSN) {
	void import('./utils/monitoring.client.tsx').then(({ init }) => init())
}

// Until hydration finishes, links and forms fall back to plain browser
// navigation. The marker lets the e2e tests wait for it (see
// tests/playwright-utils.ts).
function App() {
	useEffect(() => {
		document.documentElement.dataset.hydrated = 'true'
	}, [])
	return <HydratedRouter />
}

startTransition(() => {
	hydrateRoot(document, <App />)
})
