'use client';
import Image from 'next/image';
import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ChevronDown, Plus } from 'lucide-react';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { CustomerImage } from './customer-image';
import { WorkspaceLogo } from './workspace-logo';
import { AccountMenu } from './account-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, dateLabel, statuses, statusLabels, type Status } from '@/lib/api';
import { EmptyState, Field, Loading, Message, Modal, StatusIcon } from './ui';
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
export function CustomerPortal({
	token,
	address,
}:
	| { token: string; address?: never }
	| { token?: never; address: { workspace: string; customer: string } }) {
	const locator = address
		? [address.workspace, address.customer].map(encodeURIComponent).join('/')
		: encodeURIComponent(token);
	const { userId, isLoaded } = useAuth();
	const [creating, setCreating] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const query = useQuery({
		queryKey: ['portal', locator, userId],
		queryFn: ({ signal }) => api<Portal>(`/portal/${locator}`, { signal }),
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
							organization={{ ...query.data.workspace, id: locator }}
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
							<button
								type='button'
								className='button primary portal-new-request'
								onClick={() => {
									setSubmitted(false);
									setCreating(true);
								}}>
								<Plus size={15} aria-hidden='true' />
								New request
							</button>
						</div>
						<p className='portal-intro'>
							A shared view of your requests, progress, and updates.
						</p>
						{submitted && (
							<Message>Your request has been sent to the team.</Message>
						)}
						{creating && (
							<PortalRequestForm
								key={`${locator}:${userId}`}
								locator={locator}
								userId={userId}
								onClose={() => setCreating(false)}
								onSubmitted={() => {
									setCreating(false);
									setSubmitted(true);
								}}
							/>
						)}
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
								Have something in mind? Create a request to let the team know.
							</EmptyState>
						)}
					</>
				)}
			</main>
		</div>
	);
}

function PortalRequestForm({
	locator,
	userId,
	onClose,
	onSubmitted,
}: {
	locator: string;
	userId: string | null | undefined;
	onClose: () => void;
	onSubmitted: () => void;
}) {
	const client = useQueryClient();
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const mutation = useMutation({
		mutationFn: () =>
			api(`/portal/${locator}/requests`, {
				method: 'POST',
				body: { title: title.trim(), description },
			}),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ['portal', locator, userId] });
			onSubmitted();
		},
	});
	return (
		<Modal title='New request' onClose={() => !mutation.isPending && onClose()}>
			<form
				className='form-stack'
				onSubmit={(event) => {
					event.preventDefault();
					if (title.trim() && !mutation.isPending) mutation.mutate();
				}}>
				<p className='muted'>
					Tell the team what you need. You can follow progress here.
				</p>
				<Field label='Title'>
					<input
						required
						maxLength={240}
						placeholder='What would you like to request?'
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						disabled={mutation.isPending}
					/>
				</Field>
				<Field
					label='Description (optional)'
					hint='Share any context that would help the team.'>
					<textarea
						rows={5}
						maxLength={20000}
						placeholder='Describe what you need and why it matters…'
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						disabled={mutation.isPending}
					/>
				</Field>
				{mutation.error && <Message error>{mutation.error.message}</Message>}
				<div className='form-actions'>
					<button
						type='button'
						className='button'
						onClick={onClose}
						disabled={mutation.isPending}>
						Cancel
					</button>
					<button
						className='button primary'
						disabled={!title.trim() || mutation.isPending}>
						{mutation.isPending ? 'Submitting…' : 'Submit request'}
					</button>
				</div>
			</form>
		</Modal>
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
