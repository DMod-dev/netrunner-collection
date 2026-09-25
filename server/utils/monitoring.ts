import { nodeProfilingIntegration } from '@sentry/profiling-node'
import * as Sentry from '@sentry/react-router'
import { redactSentryRequest } from '../../app/utils/log-redaction.ts'
import { sentryDataCollection } from '../../app/utils/sentry-data-collection.ts'
import {
	isHealthcheckTransaction,
	shouldDropErrorEvent,
} from '../../app/utils/sentry-event-filters.ts'

export function init() {
	Sentry.init({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.NODE_ENV,
		dataCollection: sentryDataCollection,
		// Sentry 11 streams spans by default, which skips beforeSendTransaction
		// below (healthcheck drop and URL redaction). Keep whole transactions
		// until those filters move to ignoreSpans/beforeSendSpan.
		traceLifecycle: 'static',
		denyUrls: [
			/\/resources\/healthcheck/,
			// TODO: be smarter about the public assets...
			/\/build\//,
			/\/favicons\//,
			/\/img\//,
			/\/fonts\//,
			/\/favicon.ico/,
			/\/site\.webmanifest/,
		],
		ignoreErrors: [
			// Bots/scanners hitting routes without the matching loader/action/method.
			/did not provide an `action`/,
			/did not provide a `loader`/,
			/^Invalid request method /,
		],
		integrations: [
			// Sentry 11 ships its own Prisma tracing helper, so it no longer takes
			// an @prisma/instrumentation instance.
			Sentry.prismaIntegration(),
			Sentry.httpIntegration(),
			nodeProfilingIntegration(),
		],
		tracesSampler(samplingContext) {
			// ignore healthcheck transactions by other services (consul, etc.)
			if (
				samplingContext.normalizedRequest?.url?.includes(
					'/resources/healthcheck',
				)
			) {
				return 0
			}
			return process.env.NODE_ENV === 'production' ? 1 : 0
		},
		beforeSend(event) {
			if (shouldDropErrorEvent(event)) {
				return null
			}
			// One-time codes and email addresses travel in verify-link query
			// strings; scrub them like the access log does.
			return redactSentryRequest(event)
		},
		beforeSendTransaction(event) {
			// Drop Fly/consul healthchecks, including orphaned Prisma spans that
			// surface as Slow DB Query insights with transaction prisma:client:operation.
			if (isHealthcheckTransaction(event)) {
				return null
			}

			return redactSentryRequest(event)
		},
	})
}
