// import { createCookieSessionStorage } from 'react-router'
import { type ProviderName } from './connections.tsx'
import { GitHubProvider } from './providers/github.server.ts'
import { type AuthProvider } from './providers/provider.ts'
import { type Timings } from './timing.server.ts'

export const providers: Record<ProviderName, AuthProvider> = {
	github: new GitHubProvider(),
}

export function handleMockAction(providerName: ProviderName, request: Request) {
	return providers[providerName].handleMockAction(request)
}

export function resolveConnectionData(
	providerName: ProviderName,
	providerId: string,
	options?: { timings?: Timings },
) {
	return providers[providerName].resolveConnectionData(providerId, options)
}

/**
 * Providers that are set up in this environment. GitHub login only appears
 * once GITHUB_CLIENT_ID is set (tests and dev use a mocked one).
 */
export function getEnabledProviderNames(): Array<ProviderName> {
	// taken from `providers` rather than connections.tsx so this module (used
	// by tests) doesn't import UI code
	return (Object.keys(providers) as Array<ProviderName>).filter((name) => {
		switch (name) {
			case 'github':
				return Boolean(process.env.GITHUB_CLIENT_ID)
		}
	})
}
