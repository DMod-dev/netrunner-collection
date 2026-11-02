import closeWithGrace from 'close-with-grace'
import { HttpNetworkFrame } from 'msw/experimental'
import { setupServer } from 'msw/node'
import { handlers as githubHandlers } from './github.ts'
import { handlers as pwnedPasswordApiHandlers } from './pwned-passwords.ts'
import { handlers as resendHandlers } from './resend.ts'
import { handlers as tigrisHandlers } from './tigris.ts'

export const server = setupServer(
	...resendHandlers,
	...githubHandlers,
	...tigrisHandlers,
	...pwnedPasswordApiHandlers,
)

server.listen({
	onUnhandledFrame({ frame, defaults }) {
		const url = frame instanceof HttpNetworkFrame ? frame.data.request.url : ''
		// Do not print warnings on unhandled requests to https://<:userId>.ingest.us.sentry.io/api/
		// Note: a request handler with passthrough is not suited with this type of url
		//       until there is a more permissible url catching system
		//       like requested at https://github.com/mswjs/msw/issues/1804
		if (url.includes('.sentry.io')) {
			return
		}
		// React-router-devtools send custom requests internally to handle some functionality, we ignore those
		if (url.includes('__rrdt')) {
			return
		}
		// Print the regular MSW unhandled request warning otherwise.
		defaults.warn()
	},
})

if (process.env.NODE_ENV !== 'test') {
	console.info('🔶 Mock server installed')

	closeWithGrace(() => {
		server.close()
	})
}
