import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import * as E from '@react-email/components'
import { data, redirect, Form, useSearchParams } from 'react-router'
import { HoneypotInputs } from 'remix-utils/honeypot/react'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireAnonymous } from '#app/utils/auth.server.ts'
import { getEnabledProviderNames } from '#app/utils/connections.server.ts'
import { ProviderConnectionForm } from '#app/utils/connections.tsx'
import { prisma } from '#app/utils/db.server.ts'
import {
	claimEmailCooldown,
	releaseEmailCooldown,
} from '#app/utils/email-cooldown.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { checkHoneypot } from '#app/utils/honeypot.server.ts'
import { getDomainUrl, useIsPending } from '#app/utils/misc.tsx'
import { EmailSchema } from '#app/utils/user-validation.ts'
import { type Route } from './+types/signup.ts'
import { getRedirectToUrl, prepareVerification } from './verify.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

const SignupSchema = z.object({
	email: EmailSchema,
})

export async function loader({ request }: Route.LoaderArgs) {
	await requireAnonymous(request)
	return { providerNames: getEnabledProviderNames() }
}

export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData()

	await checkHoneypot(formData)

	const submission = parseWithZod(formData, { schema: SignupSchema })
	if (submission.status !== 'success') {
		return data(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}
	const { email } = submission.value

	// Same page either way, so this form can't be used to find out which
	// emails have an account. A registered address gets a note pointing at
	// login and password reset instead of a code; either way at most one
	// email a minute.
	const redirectTo = getRedirectToUrl({
		request,
		type: 'onboarding',
		target: email,
	})
	if (!claimEmailCooldown('signup', email)) {
		return redirect(redirectTo.toString())
	}
	const existingUser = await prisma.user.findUnique({
		where: { email },
		select: { id: true },
	})

	let response: Awaited<ReturnType<typeof sendEmail>>
	if (existingUser) {
		const origin = getDomainUrl(request)
		response = await sendEmail({
			to: email,
			subject: `You already have a Netrunner Collection account`,
			react: (
				<ExistingAccountEmail
					loginUrl={`${origin}/login`}
					resetUrl={`${origin}/forgot-password`}
				/>
			),
		})
	} else {
		const { verifyUrl, otp } = await prepareVerification({
			period: 10 * 60,
			request,
			type: 'onboarding',
			target: email,
		})
		response = await sendEmail({
			to: email,
			subject: `Welcome to Netrunner Collection!`,
			react: <SignupEmail onboardingUrl={verifyUrl.toString()} otp={otp} />,
		})
	}

	if (response.status === 'success') {
		return redirect(redirectTo.toString())
	} else {
		releaseEmailCooldown('signup', email)
		return data(
			{
				result: submission.reply({ formErrors: [response.error.message] }),
			},
			{
				status: 500,
			},
		)
	}
}

function ExistingAccountEmail({
	loginUrl,
	resetUrl,
}: {
	loginUrl: string
	resetUrl: string
}) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<h1>
					<E.Text>You already have an account</E.Text>
				</h1>
				<p>
					<E.Text>
						Someone (probably you) tried to sign up for Netrunner Collection
						with this email address, but it already has an account.
					</E.Text>
				</p>
				<p>
					<E.Text>
						<E.Link href={loginUrl}>Log in</E.Link> to your existing account, or{' '}
						<E.Link href={resetUrl}>reset your password</E.Link> if you've
						forgotten it.
					</E.Text>
				</p>
				<p>
					<E.Text>If this wasn't you, you can safely ignore this email.</E.Text>
				</p>
			</E.Container>
		</E.Html>
	)
}

export function SignupEmail({
	onboardingUrl,
	otp,
}: {
	onboardingUrl: string
	otp: string
}) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<h1>
					<E.Text>Welcome to Netrunner Collection!</E.Text>
				</h1>
				<p>
					<E.Text>
						Here's your verification code: <strong>{otp}</strong>
					</E.Text>
				</p>
				<p>
					<E.Text>Or click the link to get started:</E.Text>
				</p>
				<E.Link href={onboardingUrl}>{onboardingUrl}</E.Link>
			</E.Container>
		</E.Html>
	)
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Sign Up | Netrunner Collection' }]
}

export default function SignupRoute({
	actionData,
	loaderData,
}: Route.ComponentProps) {
	const isPending = useIsPending()
	const [searchParams] = useSearchParams()
	const redirectTo = searchParams.get('redirectTo')

	const [form, fields] = useForm({
		id: 'signup-form',
		constraint: getZodConstraint(SignupSchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			const result = parseWithZod(formData, { schema: SignupSchema })
			return result
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<div className="container flex flex-col justify-center pt-20 pb-32">
			<div className="text-center">
				<h1 className="text-h1">Let's start your journey!</h1>
				<p className="text-body-md text-muted-foreground mt-3">
					Please enter your email.
				</p>
			</div>
			<div className="mx-auto mt-16 max-w-sm min-w-full sm:min-w-[368px]">
				<Form method="POST" {...getFormProps(form)}>
					<HoneypotInputs />
					<Field
						labelProps={{
							htmlFor: fields.email.id,
							children: 'Email',
						}}
						inputProps={{
							...getInputProps(fields.email, { type: 'email' }),
							autoFocus: true,
							autoComplete: 'email',
						}}
						errors={fields.email.errors}
					/>
					<ErrorList errors={form.errors} id={form.errorId} />
					<StatusButton
						className="w-full"
						status={isPending ? 'pending' : (form.status ?? 'idle')}
						type="submit"
						disabled={isPending}
					>
						Submit
					</StatusButton>
				</Form>
				<ul className="flex flex-col gap-4 py-4">
					{loaderData.providerNames.map((providerName) => (
						<>
							<hr />
							<li key={providerName}>
								<ProviderConnectionForm
									type="Signup"
									providerName={providerName}
									redirectTo={redirectTo}
								/>
							</li>
						</>
					))}
				</ul>
			</div>
		</div>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
