import { Lock01, Plus, Trash01 } from '@untitledui/icons'
import { Passkey } from '#app/components/ui/brand-icons.tsx'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { startRegistration } from '@simplewebauthn/browser'
import { formatDistanceToNow } from 'date-fns'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { data, useFetcher, useRevalidator } from 'react-router'
import { z } from 'zod'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { pageTitle, useDoubleCheck } from '#app/utils/misc.tsx'
import {
	createToastHeaders,
	redirectWithToast,
} from '#app/utils/toast.server.ts'
import { type Route } from './+types/passkeys.ts'
import { type BreadcrumbHandle } from './_layout.tsx'

export const handle: BreadcrumbHandle & SEOHandle = {
	breadcrumb: <Icon icon={Passkey}>Passkeys</Icon>,
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Passkeys') }]

async function errorWithToast(description: string) {
	return data({ status: 'error' } as const, {
		status: 400,
		headers: await createToastHeaders({
			type: 'error',
			title: 'Could not delete passkey',
			description,
		}),
	})
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const passkeys = await prisma.passkey.findMany({
		where: { userId },
		orderBy: { createdAt: 'desc' },
		select: {
			id: true,
			deviceType: true,
			createdAt: true,
		},
	})
	return { passkeys }
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'delete') {
		const passkeyId = formData.get('passkeyId')
		if (typeof passkeyId !== 'string') {
			return errorWithToast('Invalid passkey ID.')
		}

		const { count } = await prisma.passkey.deleteMany({
			where: {
				id: passkeyId,
				userId, // Ensure the passkey belongs to the user
			},
		})
		if (count === 0) {
			return errorWithToast('That passkey no longer exists.')
		}
		return redirectWithToast('/settings/profile/passkeys', {
			type: 'success',
			title: 'Passkey deleted',
			description: 'Your passkey has been deleted.',
		})
	}

	return errorWithToast('Invalid intent.')
}

const RegistrationOptionsSchema = z.object({
	options: z.object({
		rp: z.object({
			id: z.string(),
			name: z.string(),
		}),
		user: z.object({
			id: z.string(),
			name: z.string(),
			displayName: z.string(),
		}),
		challenge: z.string(),
		pubKeyCredParams: z.array(
			z.object({
				type: z.literal('public-key'),
				alg: z.number(),
			}),
		),
		authenticatorSelection: z
			.object({
				authenticatorAttachment: z
					.enum(['platform', 'cross-platform'])
					.optional(),
				residentKey: z
					.enum(['required', 'preferred', 'discouraged'])
					.optional(),
				userVerification: z
					.enum(['required', 'preferred', 'discouraged'])
					.optional(),
				requireResidentKey: z.boolean().optional(),
			})
			.optional(),
	}),
}) satisfies z.ZodType<{ options: PublicKeyCredentialCreationOptionsJSON }>

export default function Passkeys({ loaderData }: Route.ComponentProps) {
	const revalidator = useRevalidator()
	const [error, setError] = useState<string | null>(null)

	async function handlePasskeyRegistration() {
		try {
			setError(null)
			const resp = await fetch('/webauthn/registration')
			const jsonResult = await resp.json()
			const parsedResult = RegistrationOptionsSchema.parse(jsonResult)

			const regResult = await startRegistration({
				optionsJSON: parsedResult.options,
			})

			const verificationResp = await fetch('/webauthn/registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(regResult),
			})

			if (!verificationResp.ok) {
				throw new Error('Failed to verify registration')
			}

			void revalidator.revalidate()
		} catch (err) {
			console.error('Failed to create passkey:', err)
			setError('Failed to create passkey. Please try again.')
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<h1 className="text-h1">Passkeys</h1>
				<form action={handlePasskeyRegistration}>
					<RegisterPasskeyButton />
				</form>
			</div>

			{error ? (
				<div className="bg-destructive/15 text-destructive rounded-lg p-4">
					{error}
				</div>
			) : null}

			{loaderData.passkeys.length ? (
				<ul className="flex flex-col gap-4" title="passkeys">
					{loaderData.passkeys.map((passkey) => (
						<PasskeyItem key={passkey.id} passkey={passkey} />
					))}
				</ul>
			) : (
				<div className="text-muted-foreground text-center">
					No passkeys registered yet
				</div>
			)}
		</div>
	)
}

function RegisterPasskeyButton() {
	// Pending for as long as the form action runs, which includes the time the
	// browser's passkey prompt is open.
	const { pending } = useFormStatus()
	return (
		<StatusButton
			type="submit"
			variant="secondary"
			className="flex items-center gap-2"
			disabled={pending}
			status={pending ? 'pending' : 'idle'}
		>
			<Icon icon={Plus}>Register new passkey</Icon>
		</StatusButton>
	)
}

function PasskeyItem({
	passkey,
}: {
	passkey: Route.ComponentProps['loaderData']['passkeys'][number]
}) {
	const dc = useDoubleCheck()
	const fetcher = useFetcher<typeof action>()
	return (
		<li className="border-muted-foreground flex items-center justify-between gap-4 rounded-lg border p-4">
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<Icon icon={Lock01} />
					<span className="font-semibold">
						{passkey.deviceType === 'platform' ? 'Device' : 'Security Key'}
					</span>
				</div>
				<div className="text-muted-foreground text-sm">
					Registered {formatDistanceToNow(new Date(passkey.createdAt))} ago
				</div>
			</div>
			<fetcher.Form method="POST">
				<input type="hidden" name="passkeyId" value={passkey.id} />
				<StatusButton
					{...dc.getButtonProps({
						type: 'submit',
						name: 'intent',
						value: 'delete',
					})}
					variant="destructive"
					size="sm"
					className="flex items-center gap-2"
					status={
						fetcher.state !== 'idle'
							? 'pending'
							: (fetcher.data?.status ?? 'idle')
					}
				>
					<Icon icon={Trash01}>
						{dc.doubleCheck ? 'Are you sure?' : 'Delete'}
					</Icon>
				</StatusButton>
			</fetcher.Form>
		</li>
	)
}
