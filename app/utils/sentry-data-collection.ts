import { type BrowserOptions } from '@sentry/react-router'
import { SENSITIVE_QUERY_PARAMS } from './log-redaction.ts'

/**
 * Sentry 11 replaced `sendDefaultPii` with `dataCollection`, whose defaults
 * collect cookies, headers, bodies and user info. This is the migration
 * guide's equivalent of v10's `sendDefaultPii: false`, so the session cookie
 * and request bodies stay out of Sentry.
 */
export const sentryDataCollection = {
	userInfo: false,
	cookies: false,
	httpHeaders: {
		request: { deny: ['forwarded', '-ip'] },
		response: { deny: ['forwarded', '-ip'] },
	},
	httpBodies: [],
	// span URLs (url.full, page loads); event.request is scrubbed in beforeSend
	urlQueryParams: { deny: ['forwarded', '-ip', ...SENSITIVE_QUERY_PARAMS] },
	genAI: { inputs: false, outputs: false },
	databaseQueryData: false,
	queues: false,
} satisfies BrowserOptions['dataCollection']
