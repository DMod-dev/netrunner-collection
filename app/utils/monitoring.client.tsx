import * as Sentry from '@sentry/react-router'
import { redactSentryRequest, redactUrl } from './log-redaction.ts'
import { sentryDataCollection } from './sentry-data-collection.ts'

export function init() {
	Sentry.init({
		dsn: ENV.SENTRY_DSN,
		environment: ENV.MODE,
		dataCollection: sentryDataCollection,
		beforeSend(event) {
			if (event.request?.url) {
				const url = new URL(event.request.url)
				if (
					url.protocol === 'chrome-extension:' ||
					url.protocol === 'moz-extension:'
				) {
					// This error is from a browser extension, ignore it
					return null
				}
			}
			// Verify links carry the one-time code and the email address in the
			// query string, and the browser SDK copies location.href into every
			// event without applying dataCollection.
			return redactSentryRequest(event)
		},
		beforeSendTransaction(event) {
			return redactSentryRequest(event)
		},
		beforeBreadcrumb(breadcrumb) {
			const data = breadcrumb.data
			if (data) {
				for (const key of ['from', 'to', 'url']) {
					if (typeof data[key] === 'string') data[key] = redactUrl(data[key])
				}
			}
			return breadcrumb
		},
		integrations: [
			Sentry.replayIntegration({
				// replays record the page URL on every navigation
				beforeAddRecordingEvent(event) {
					const data = event.data as { href?: unknown } | undefined
					if (data && typeof data.href === 'string') {
						data.href = redactUrl(data.href)
					}
					return event
				},
			}),
			Sentry.browserProfilingIntegration(),
		],

		// Set tracesSampleRate to 1.0 to capture 100%
		// of transactions for performance monitoring.
		// We recommend adjusting this value in production
		tracesSampleRate: 1.0,

		// Capture Replay for 10% of all sessions,
		// plus for 100% of sessions with an error
		replaysSessionSampleRate: 0.1,
		replaysOnErrorSampleRate: 1.0,
	})
}
