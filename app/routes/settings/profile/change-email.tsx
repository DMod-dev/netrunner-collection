import { Mail01 } from '@untitledui/icons'
import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, redirect, Form } from 'react-router'
import { z } from 'zod'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	getRedirectToUrl,
	prepareVerification,
	requireRecentVerification,
} from '#app/routes/_auth/verify.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	claimEmailCooldown,
	releaseEmailCooldown,
} from '#app/utils/email-cooldown.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { pageTitle, useIsPending } from '#app/utils/misc.tsx'
import { EmailSchema } from '#app/utils/user-validation.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { type Route } from './+types/change-email.ts'
import { type BreadcrumbHandle } from './_layout.tsx'
import { EmailChangeEmail } from './change-email.server.tsx'

export const handle: BreadcrumbHandle & SEOHandle = {
	breadcrumb: <Icon icon={Mail01}>Change Email</Icon>,
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => [
	{ title: pageTitle('Change email') },
]

export const newEmailAddressSessionKey = 'new-email-address'

const ChangeEmailSchema = z.object({
	email: EmailSchema,
})

export async function loader({ request, url }: Route.LoaderArgs) {
	await requireRecentVerification(request)
	const userId = await requireUserId(request)
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { email: true },
	})
	if (!user) {
		const params = new URLSearchParams({ redirectTo: url.href })
		throw redirect(`/login?${params}`)
	}
	return { user }
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const submission = parseWithZod(formData, { schema: ChangeEmailSchema })

	if (submission.status !== 'success') {
		return data(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}
	const { email } = submission.value

	// Same response whether or not the address already has an account (signup
	// is open, so this form mustn't tell anyone which emails are registered),
	// and at most one email a minute per address. A taken address gets no
	// code, so the change can't be completed.
	const verifySession = await verifySessionStorage.getSession()
	verifySession.set(newEmailAddressSessionKey, email)
	const sent = redirect(
		getRedirectToUrl({
			request,
			type: 'change-email',
			target: userId,
		}).toString(),
		{
			headers: {
				'set-cookie': await verifySessionStorage.commitSession(verifySession),
			},
		},
	)
	const existingUser = await prisma.user.findUnique({
		where: { email },
		select: { id: true },
	})
	if (existingUser) {
		// an earlier code (for another address) must not now apply to this one
		await prisma.verification.deleteMany({
			where: { target: userId, type: 'change-email' },
		})
		return sent
	}
	if (!claimEmailCooldown('change-email', email)) return sent

	const { otp, verifyUrl } = await prepareVerification({
		period: 10 * 60,
		request,
		target: userId,
		type: 'change-email',
	})

	const response = await sendEmail({
		to: email,
		subject: `Netrunner Collection Email Change Verification`,
		react: <EmailChangeEmail verifyUrl={verifyUrl.toString()} otp={otp} />,
	})

	if (response.status === 'success') {
		return sent
	} else {
		releaseEmailCooldown('change-email', email)
		return data(
			{ result: submission.reply({ formErrors: [response.error.message] }) },
			{ status: 500 },
		)
	}
}

export default function ChangeEmailIndex({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const [form, fields] = useForm({
		id: 'change-email-form',
		constraint: getZodConstraint(ChangeEmailSchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ChangeEmailSchema })
		},
	})

	const isPending = useIsPending()
	return (
		<div>
			<h1 className="text-h1">Change Email</h1>
			<p>You will receive an email at the new email address to confirm.</p>
			<p>
				An email notice will also be sent to your old address{' '}
				{loaderData.user.email}.
			</p>
			<div className="mx-auto mt-5 max-w-sm">
				<Form method="POST" {...getFormProps(form)}>
					<Field
						labelProps={{ children: 'New Email' }}
						inputProps={{
							...getInputProps(fields.email, { type: 'email' }),
							autoComplete: 'email',
						}}
						errors={fields.email.errors}
					/>
					<ErrorList id={form.errorId} errors={form.errors} />
					<div>
						<StatusButton
							type="submit"
							status={isPending ? 'pending' : (form.status ?? 'idle')}
						>
							Send Confirmation
						</StatusButton>
					</div>
				</Form>
			</div>
		</div>
	)
}
