/* eslint-disable import/no-duplicates */
import 'react-router'
import { createRequestHandler } from '@react-router/express'
import express from 'express'
import { type ServerBuild } from 'react-router'

declare module 'react-router' {
	interface AppLoadContext {
		serverBuild: ServerBuild
	}
}

export const app = express()

// This inner app handles every React Router response, so it needs its own
// copy of the setting the outer app in server/index.ts already disables.
app.disable('x-powered-by')

app.use(
	createRequestHandler({
		mode: process.env.NODE_ENV ?? 'development',
		build: () => import('virtual:react-router/server-build'),
		getLoadContext: async () => ({
			serverBuild: await import('virtual:react-router/server-build'),
		}),
	}),
)
