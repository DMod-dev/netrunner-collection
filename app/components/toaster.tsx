import { useEffect } from 'react'
import { toast as showToast } from 'sonner'
import { type Toast } from '#app/utils/toast.server.ts'

export function useToast(toast?: Toast | null) {
	useEffect(() => {
		if (toast) {
			setTimeout(() => {
				const details = toast.details?.length ? toast.details : null
				showToast[toast.type](toast.title, {
					id: toast.id,
					description: details ? (
						<>
							<p>{toast.description}</p>
							<ul className="mt-1 list-inside list-disc font-mono text-xs">
								{details.map((line, i) => (
									<li key={i} className="break-all">
										{line}
									</li>
								))}
							</ul>
						</>
					) : (
						toast.description
					),
					// a list takes a while to read
					...(details ? { duration: Infinity, closeButton: true } : {}),
				})
			}, 0)
		}
	}, [toast])
}
