import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { Users01 } from '@untitledui/icons'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link, useFetcher } from 'react-router'
import { z } from 'zod'
import { ErrorList, Field } from '#app/components/forms.tsx'
import {
	REMOVE_SHARE_INTENT,
	RemoveShareButton,
} from '#app/components/remove-share-button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { UserIcon } from '#app/components/user-icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	addShareByUsername,
	listSharesGiven,
	removeShareAction,
} from '#app/utils/collection-share.server.ts'
import { formatDate } from '#app/utils/dates.ts'
import { pageTitle } from '#app/utils/misc.tsx'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import { UsernameSchema } from '#app/utils/user-validation.ts'
import { type Route } from './+types/sharing.ts'
import { type BreadcrumbHandle } from './_layout.tsx'

export const handle: BreadcrumbHandle & SEOHandle = {
	breadcrumb: <Icon icon={Users01}>Sharing</Icon>,
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Sharing') }]

const ADD_SHARE_INTENT = 'add-share'

const AddShareSchema = z.object({ username: UsernameSchema })

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	return { shares: await listSharesGiven(userId) }
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	switch (formData.get('intent')) {
		case ADD_SHARE_INTENT: {
			return addShareAction(userId, formData)
		}
		case REMOVE_SHARE_INTENT: {
			return removeShareAction(userId, formData)
		}
		default: {
			throw new Response('Invalid intent', { status: 400 })
		}
	}
}

async function addShareAction(userId: string, formData: FormData) {
	const submission = parseWithZod(formData, { schema: AddShareSchema })
	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}
	const added = await addShareByUsername(userId, submission.value.username)
	if (added.status === 'error') {
		return data(
			{
				result: submission.reply({
					fieldErrors: { username: [added.message] },
				}),
			},
			{ status: 400 },
		)
	}
	return data(
		{ result: submission.reply({ resetForm: true }) },
		{
			headers: await createToastHeaders({
				type: 'success',
				title: 'Collection shared',
				description: `${added.viewer.username} can now see your collection.`,
			}),
		},
	)
}

export default function SharingRoute({ loaderData }: Route.ComponentProps) {
	const { shares } = loaderData
	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-2">
				<h1 className="text-h1">Sharing</h1>
				<p className="text-muted-foreground max-w-prose">
					Let other users see your collection. They can browse your cards and
					sets, with how many copies and which versions you own, but can’t
					change anything, run a deck check or export it. They’ll find it under{' '}
					<strong>Shared with me</strong> on their collection page.
				</p>
			</div>

			<AddShareForm />

			<section aria-labelledby="shared-with" className="flex flex-col gap-4">
				<h2 id="shared-with" className="text-lg font-bold">
					Shared with
				</h2>
				{shares.length ? (
					<ul className="flex flex-col gap-3">
						{shares.map((share) => {
							const name = share.viewer.name ?? share.viewer.username
							return (
								<li
									key={share.id}
									className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
								>
									<Link
										to={`/users/${share.viewer.username}`}
										className="flex min-w-0 items-center gap-3"
									>
										<UserIcon className="bg-muted size-10" />
										<span className="flex min-w-0 flex-col">
											<span className="truncate font-semibold">{name}</span>
											<span className="text-muted-foreground truncate text-sm">
												@{share.viewer.username} · since{' '}
												{formatDate(share.createdAt)}
											</span>
										</span>
									</Link>
									<RemoveShareButton
										shareId={share.id}
										label="Stop sharing"
										accessibleName={`Stop sharing with ${name}`}
									/>
								</li>
							)
						})}
					</ul>
				) : (
					<p className="text-muted-foreground bg-muted/50 rounded-lg border border-dashed px-6 py-8 text-center text-sm">
						Your collection isn’t shared with anyone.
					</p>
				)}
			</section>
		</div>
	)
}

function AddShareForm() {
	const fetcher = useFetcher<typeof addShareAction>()
	const [form, fields] = useForm({
		id: 'add-share',
		constraint: getZodConstraint(AddShareSchema),
		lastResult: fetcher.data?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: AddShareSchema })
		},
		shouldRevalidate: 'onBlur',
	})
	return (
		<fetcher.Form
			method="POST"
			className="flex flex-col gap-2"
			{...getFormProps(form)}
		>
			<div className="flex flex-wrap items-start gap-x-4">
				<Field
					className="min-w-0 flex-1 basis-60"
					labelProps={{
						htmlFor: fields.username.id,
						children: 'Share with username',
					}}
					inputProps={{
						...getInputProps(fields.username, { type: 'text' }),
						autoComplete: 'off',
						autoCapitalize: 'none',
						spellCheck: false,
					}}
					errors={fields.username.errors}
				/>
				<StatusButton
					type="submit"
					name="intent"
					value={ADD_SHARE_INTENT}
					className="mt-6"
					status={fetcher.state !== 'idle' ? 'pending' : 'idle'}
				>
					Share
				</StatusButton>
			</div>
			<ErrorList errors={form.errors} id={form.errorId} />
		</fetcher.Form>
	)
}
