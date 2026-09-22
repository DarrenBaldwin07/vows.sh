'use client';
import Image from 'next/image';
import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ChevronDown } from 'lucide-react';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { CustomerImage } from './customer-image';
import { WorkspaceLogo } from './workspace-logo';
import { AccountMenu } from './account-menu';
import { useQuery } from '@tanstack/react-query';
import { api, dateLabel, statuses, statusLabels, type Status } from '@/lib/api';
import { EmptyState, Loading, Message, StatusIcon } from './ui';
type Portal = {
	customer: { name: string; imageData: string | null };
	workspace: { name: string; imageUrl: string; hasImage: boolean } | null;
	requests: {
		id: string;
		title: string;
		description: string;
		status: Status;
		updatedAt: string;
		completionNote: string;
		assignee: { name: string; imageUrl: string | null } | null;
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
				<div className='portal-brand'>
					{query.data?.workspace ? (
						<WorkspaceLogo
							organization={{ ...query.data.workspace, id: token }}
							showLoadingSkeleton
						/>
					) : query.isPending ? (
						<span
							className='workspace-logo-frame skeleton'
							aria-hidden='true'
						/>
					) : null}
					<div>
						<strong>{query.data?.workspace?.name ?? 'Customer portal'}</strong>
						{query.data?.workspace && <span>Customer portal</span>}
					</div>
				</div>
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
						<p className='portal-eyebrow'>Your customer space</p>
						<div className='portal-customer-heading'>
							{query.data.customer.imageData && (
								<CustomerImage
									name={query.data.customer.name}
									imageData={query.data.customer.imageData}
								/>
							)}
							<h1>{query.data.customer.name}</h1>
						</div>
						<p className='portal-intro'>
							A shared view of your requests, progress, and updates.
						</p>
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
											<h2 className={`status-${status}`}>
												{statusLabels[status]} <span>{rows.length}</span>
											</h2>
											{rows.map((row) => (
												<details className='portal-request' key={row.id}>
													<summary>
														<span
															className='portal-status-icon'
															title={statusLabels[row.status]}>
															<StatusIcon status={row.status} />
															<span className='sr-only'>
																{statusLabels[row.status]}
															</span>
														</span>
														<span className='portal-request-title'>
															<span>{row.title}</span>
															<ChevronDown
																className='portal-request-chevron'
																size={14}
																aria-hidden='true'
															/>
														</span>
														<PortalAssignee assignee={row.assignee} />
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

function PortalAssignee({
	assignee,
}: {
	assignee: Portal['requests'][number]['assignee'];
}) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	return (
		<TooltipProvider delayDuration={250}>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type='button'
						className='portal-assignee border-0 bg-transparent p-0'>
						{assignee?.imageUrl && failedUrl !== assignee.imageUrl ? (
							<Image
								src={assignee.imageUrl}
								alt=''
								width={22}
								height={22}
								unoptimized
								onError={() => setFailedUrl(assignee.imageUrl)}
							/>
						) : (
							<span className='portal-assignee-avatar' aria-hidden='true'>
								{assignee ? Array.from(assignee.name)[0]?.toUpperCase() : '–'}
							</span>
						)}
						<span className='portal-assignee-name'>
							{assignee?.name ?? 'Unassigned'}
						</span>
					</button>
				</TooltipTrigger>
				<TooltipContent side='top' sideOffset={4}>
					{assignee
						? `This request is assigned to ${assignee.name}`
						: 'This request is unassigned'}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
