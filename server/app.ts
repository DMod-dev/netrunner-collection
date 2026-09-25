import { createRequestHandler } from '@react-router/express'
import express from 'express'
import { RouterContextProvider } from 'react-router'
import { serverBuildContext } from '#app/utils/server-build-context.server.ts'

export const app = express()

// This inner app handles every React Router response, so it needs its own
// copy of the setting the outer app in server/index.ts already disables.
app.disable('x-powered-by')

app.use(
	createRequestHandler({
		mode: process.env.NODE_ENV ?? 'development',
		build: () => import('virtual:react-router/server-build'),
		getLoadContext: async () => {
			const context = new RouterContextProvider()
			context.set(
				serverBuildContext,
				await import('virtual:react-router/server-build'),
			)
			return context
		},
	}),
)
