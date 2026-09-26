import {
	Download01,
	Link01,
	Lock01,
	LockUnlocked01,
	Mail01,
	Passcode,
	Trash01,
	User01,
	Users01,
} from '@untitledui/icons'
import { Passkey } from '#app/components/ui/brand-icons.tsx'
import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link, useFetcher } from 'react-router'
import { z } from 'zod'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { UserIcon } from '#app/components/user-icon.tsx'
import { requireUserId, sessionKey } from '#app/utils/auth.server.ts'
import { getEnabledProviderNames } from '#app/utils/connections.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { pageTitle, useDoubleCheck } from '#app/utils/misc.tsx'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { NameSchema, UsernameSchema } from '#app/utils/user-validation.ts'
import { type Route } from './+types/index.ts'
import { twoFAVerificationType } from './two-factor/_layout.tsx'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Profile') }]

const ProfileFormSchema = z.object({
	name: NameSchema.nullable().default(null),
	username: UsernameSchema,
})

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: {
			id: true,
			name: true,
			username: true,
			email: true,
			_count: {
				select: {
					sessions: {
						where: {
							expirationDate: { gt: new Date() },
						},
					},
				},
			},
		},
	})

	const twoFactorVerification = await prisma.verification.findUnique({
		select: { id: true },
		where: { target_type: { type: twoFAVerificationType, target: userId } },
	})

	const password = await prisma.password.findUnique({
		select: { userId: true },
		where: { userId },
	})

	return {
		user,
		hasPassword: Boolean(password),
		isTwoFactorEnabled: Boolean(twoFactorVerification),
		showConnections:
			getEnabledProviderNames().length > 0 ||
			(await prisma.connection.count({ where: { userId } })) > 0,
	}
}

type ProfileActionArgs = {
	request: Request
	userId: string
	formData: FormData
}
const profileUpdateActionIntent = 'update-profile'
const signOutOfSessionsActionIntent = 'sign-out-of-sessions'
const deleteDataActionIntent = 'delete-data'

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')
	switch (intent) {
		case profileUpdateActionIntent: {
			return profileUpdateAction({ request, userId, formData })
		}
		case signOutOfSessionsActionIntent: {
			return signOutOfSessionsAction({ request, userId, formData })
		}
		case deleteDataActionIntent: {
			return deleteDataAction({ request, userId, formData })
		}
		default: {
			throw new Response('Invalid intent', { status: 400 })
		}
	}
}

export default function EditUserProfile({ loaderData }: Route.ComponentProps) {
	return (
		<div className="flex flex-col gap-12">
			<div className="flex flex-col items-center gap-6">
				<UserIcon className="size-52" />
				<h1 className="text-h1">Settings</h1>
			</div>
			<UpdateProfile loaderData={loaderData} />

			<div className="flex flex-col gap-6">
				<div>
					<Link to="change-email">
						<Icon icon={Mail01}>Change email from {loaderData.user.email}</Icon>
					</Link>
				</div>
				<div>
					<Link to="two-factor">
						{loaderData.isTwoFactorEnabled ? (
							<Icon icon={Lock01}>2FA is enabled</Icon>
						) : (
							<Icon icon={LockUnlocked01}>Enable 2FA</Icon>
						)}
					</Link>
				</div>
				<div>
					<Link to={loaderData.hasPassword ? 'password' : 'password/create'}>
						<Icon icon={Passcode}>
							{loaderData.hasPassword ? 'Change Password' : 'Create a Password'}
						</Icon>
					</Link>
				</div>
				{loaderData.showConnections ? (
					<div>
						<Link to="connections">
							<Icon icon={Link01}>Manage connections</Icon>
						</Link>
					</div>
				) : null}
				<div>
					<Link to="sharing">
						<Icon icon={Users01}>Share your collection</Icon>
					</Link>
				</div>
				<div>
					<Link to="passkeys">
						<Icon icon={Passkey}>Manage passkeys</Icon>
					</Link>
				</div>
				<div>
					<Link
						reloadDocument
						download="my-netrunner-collection-data.json"
						to="/resources/download-user-data"
					>
						<Icon icon={Download01}>Download your data</Icon>
					</Link>
				</div>
				<SignOutOfSessions loaderData={loaderData} />
				<DeleteData />
			</div>
		</div>
	)
}

async function profileUpdateAction({ userId, formData }: ProfileActionArgs) {
	const submission = await parseWithZod(formData, {
		async: true,
		schema: ProfileFormSchema.superRefine(async ({ username }, ctx) => {
			const existingUsername = await prisma.user.findUnique({
				where: { username },
				select: { id: true },
			})
			if (existingUsername && existingUsername.id !== userId) {
				ctx.addIssue({
					path: ['username'],
					code: z.ZodIssueCode.custom,
					message: 'A user already exists with this username',
				})
			}
		}),
	})
	if (submission.status !== 'success') {
		return data(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}

	const { username, name } = submission.value

	await prisma.user.update({
		select: { username: true },
		where: { id: userId },
		data: {
			name: name,
			username: username,
		},
	})

	return redirectWithToast('/settings/profile', {
		type: 'success',
		title: 'Profile updated',
		description: 'Your changes have been saved.',
	})
}

function UpdateProfile({
	loaderData,
}: {
	loaderData: Route.ComponentProps['loaderData']
}) {
	const fetcher = useFetcher<typeof profileUpdateAction>()

	const [form, fields] = useForm({
		id: 'edit-profile',
		constraint: getZodConstraint(ProfileFormSchema),
		lastResult: fetcher.data?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ProfileFormSchema })
		},
		defaultValue: {
			username: loaderData.user.username,
			name: loaderData.user.name,
		},
	})

	return (
		<fetcher.Form method="POST" {...getFormProps(form)}>
			<div className="grid grid-cols-6 gap-x-10">
				<Field
					className="col-span-3"
					labelProps={{
						htmlFor: fields.username.id,
						children: 'Username',
					}}
					inputProps={getInputProps(fields.username, { type: 'text' })}
					errors={fields.username.errors}
				/>
				<Field
					className="col-span-3"
					labelProps={{ htmlFor: fields.name.id, children: 'Name' }}
					inputProps={getInputProps(fields.name, { type: 'text' })}
					errors={fields.name.errors}
				/>
			</div>

			<ErrorList errors={form.errors} id={form.errorId} />

			<div className="mt-8 flex justify-center">
				<StatusButton
					type="submit"
					size="lg"
					className="px-24"
					name="intent"
					value={profileUpdateActionIntent}
					status={
						fetcher.state !== 'idle' ? 'pending' : (form.status ?? 'idle')
					}
				>
					Save changes
				</StatusButton>
			</div>
		</fetcher.Form>
	)
}

async function signOutOfSessionsAction({ request, userId }: ProfileActionArgs) {
	const authSession = await authSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const sessionId = authSession.get(sessionKey)
	invariantResponse(
		sessionId,
		'You must be authenticated to sign out of other sessions',
	)
	await prisma.session.deleteMany({
		where: {
			userId,
			id: { not: sessionId },
		},
	})
	return { status: 'success' } as const
}

function SignOutOfSessions({
	loaderData,
}: {
	loaderData: Route.ComponentProps['loaderData']
}) {
	const dc = useDoubleCheck()

	const fetcher = useFetcher<typeof signOutOfSessionsAction>()
	const otherSessionsCount = loaderData.user._count.sessions - 1
	return (
		<div>
			{otherSessionsCount ? (
				<fetcher.Form method="POST">
					<StatusButton
						{...dc.getButtonProps({
							type: 'submit',
							name: 'intent',
							value: signOutOfSessionsActionIntent,
						})}
						variant={dc.doubleCheck ? 'destructive' : 'default'}
						status={
							fetcher.state !== 'idle'
								? 'pending'
								: (fetcher.data?.status ?? 'idle')
						}
					>
						<Icon icon={User01}>
							{dc.doubleCheck
								? `Are you sure?`
								: `Sign out of ${otherSessionsCount} other ${
										otherSessionsCount === 1 ? 'session' : 'sessions'
									}`}
						</Icon>
					</StatusButton>
				</fetcher.Form>
			) : (
				<Icon icon={User01}>This is your only session</Icon>
			)}
		</div>
	)
}

async function deleteDataAction({ userId }: ProfileActionArgs) {
	await prisma.user.delete({ where: { id: userId } })
	return redirectWithToast('/', {
		type: 'success',
		title: 'Data Deleted',
		description: 'All of your data has been deleted',
	})
}

function DeleteData() {
	const dc = useDoubleCheck()

	const fetcher = useFetcher<typeof deleteDataAction>()
	return (
		<div>
			<fetcher.Form method="POST">
				<StatusButton
					{...dc.getButtonProps({
						type: 'submit',
						name: 'intent',
						value: deleteDataActionIntent,
					})}
					variant={dc.doubleCheck ? 'destructive' : 'default'}
					status={fetcher.state !== 'idle' ? 'pending' : 'idle'}
				>
					<Icon icon={Trash01}>
						{dc.doubleCheck ? `Are you sure?` : `Delete all your data`}
					</Icon>
				</StatusButton>
			</fetcher.Form>
		</div>
	)
}
