import { ArrowLeft } from '@untitledui/icons'
import { captureException } from '@sentry/react-router'
import { useEffect, type ReactElement } from 'react'
import {
	type ErrorResponse,
	isRouteErrorResponse,
	Link,
	useParams,
	useRouteError,
} from 'react-router'
import { getErrorMessage } from '#app/utils/misc.tsx'
import { Icon } from './ui/icon.tsx'

type StatusHandler = (info: {
	error: ErrorResponse
	params: Record<string, string | undefined>
}) => ReactElement | null

const statusHeadings: Record<number, string> = {
	400: 'Bad request',
	401: 'Log in required',
	403: 'Access denied',
	404: 'Not found',
}

/**
 * Error responses carry whatever the loader threw: usually a string, sometimes
 * an object (e.g. `data({ message })`). Never render `[object Object]`.
 */
export function formatErrorData(data: unknown) {
	if (data == null || data === '') return null
	if (typeof data === 'string') return data
	if (
		typeof data === 'object' &&
		'message' in data &&
		typeof data.message === 'string'
	) {
		return data.message
	}
	try {
		return JSON.stringify(data)
	} catch {
		return 'Unknown error'
	}
}

export function GeneralErrorBoundary({
	defaultStatusHandler = ({ error }) => {
		const message = formatErrorData(error.data)
		return message ? <p className="break-words">{message}</p> : null
	},
	statusHandlers,
	unexpectedErrorHandler = (error) => (
		<p className="break-words">{getErrorMessage(error)}</p>
	),
}: {
	defaultStatusHandler?: StatusHandler
	statusHandlers?: Record<number, StatusHandler>
	unexpectedErrorHandler?: (error: unknown) => ReactElement | null
}) {
	const error = useRouteError()
	const params = useParams()
	const isResponse = isRouteErrorResponse(error)

	if (typeof document !== 'undefined') {
		console.error(error)
	}

	useEffect(() => {
		if (isResponse) return

		captureException(error)
	}, [error, isResponse])

	const heading = isResponse
		? (statusHeadings[error.status] ?? `Error ${error.status}`)
		: 'Something went wrong'

	return (
		<main className="container flex justify-center py-12 sm:py-20">
			<div className="flex w-full max-w-xl flex-col gap-4">
				<h1 className="text-h2">{heading}</h1>
				<div className="text-body-md text-muted-foreground">
					{isResponse
						? (statusHandlers?.[error.status] ?? defaultStatusHandler)({
								error,
								params,
							})
						: unexpectedErrorHandler(error)}
				</div>
				<Link to="/" className="text-body-md self-start underline">
					<Icon icon={ArrowLeft}>Back to home</Icon>
				</Link>
			</div>
		</main>
	)
}
