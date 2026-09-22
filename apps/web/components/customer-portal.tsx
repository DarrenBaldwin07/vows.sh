'use client';
import { useAuth } from '@clerk/nextjs';
import { AccountMenu } from './account-menu';
import { useQuery } from '@tanstack/react-query';
import { api, dateLabel, statuses, statusLabels, type Status } from '@/lib/api';
import { EmptyState, Loading, Message, StatusBadge } from './ui';
type Portal = {
	customer: { name: string };
	requests: {
		id: string;
		title: string;
		description: string;
		status: Status;
		updatedAt: string;
		completionNote: string;
	}[];
};
export function CustomerPortal({ token }: { token: string }) {
	const { userId, isLoaded } = useAuth();
	const query = useQuery({
		queryKey: ['portal', token, userId],
		queryFn: ({ signal }) =>
			api<Portal>(`/portal/${encodeURIComponent(token)}`, { signal }),
		enabled: isLoaded && Boolean(userId),
		retry: false,
		refetchInterval: 30000,
	});
	return (
		<div className='portal'>
			<header className='portal-header'>
				<span>Customer portal</span>
				<div>
					<AccountMenu />
				</div>
			</header>
			<main className='portal-content'>
				{query.isPending ? (
					<Loading />
				) : query.error ? (
					<EmptyState title='This portal isn’t available to this account'>
						<Message error>{query.error.message}</Message>
					</EmptyState>
				) : (
					<>
						<h1>{query.data.customer.name}</h1>
						<p className='portal-intro'>Requests and status updates.</p>
						<div className='portal-summary'>
							<span>
								<strong>
									{
										query.data.requests.filter(
											(r) => !['done', 'canceled'].includes(r.status)
										).length
									}
								</strong>{' '}
								open
							</span>
							<span>
								<strong>
									{
										query.data.requests.filter((r) => r.status === 'done')
											.length
									}
								</strong>{' '}
								completed
							</span>
							<span className='portal-live'>Updates automatically</span>
						</div>
						{query.data.requests.length ? (
							statuses.map((status) => {
								const rows = query.data.requests.filter(
									(r) => r.status === status
								);
								return (
									rows.length > 0 && (
										<section key={status} className='portal-group'>
											<h2>
												{statusLabels[status]} <span>{rows.length}</span>
											</h2>
											{rows.map((row) => (
												<details className='portal-request' key={row.id}>
													<summary>
														<span>{row.title}</span>
														<StatusBadge status={row.status} />
													</summary>
													<div className='portal-request-body'>
														<p>
															{row.description ||
																'Your team is tracking this request. Check back here for updates.'}
														</p>
														{row.status === 'done' && row.completionNote && (
															<div className='completion-note'>
																<strong>A note from the team</strong>
																<p>{row.completionNote}</p>
															</div>
														)}
														<small>
															Last updated {dateLabel(row.updatedAt)}
														</small>
													</div>
												</details>
											))}
										</section>
									)
								);
							})
						) : (
							<EmptyState title='Your requests will appear here'>
								Your contact will add requests as they come in.
							</EmptyState>
						)}
					</>
				)}
			</main>
		</div>
	);
}
