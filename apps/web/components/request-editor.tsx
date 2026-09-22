'use client';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	api,
	dateLabel,
	statuses,
	statusLabels,
	type RequestDetail,
} from '@/lib/api';
import { Field, Loading, Message, Modal } from './ui';

export function RequestEditor({
	customerId,
	requestId,
	onClose,
}: {
	customerId: string;
	requestId: string | null;
	onClose: () => void;
}) {
	const { orgId } = useAuth();
	const cache = useQueryClient();
	const [confirmSend, setConfirmSend] = useState(false);
	const query = useQuery({
		queryKey: ['request', orgId, requestId],
		queryFn: () =>
			api<RequestDetail>(`/manage/requests/${requestId}`, {
				organizationId: orgId,
			}),
		enabled: Boolean(requestId),
		refetchInterval: 15000,
	});
	const members = useQuery({
		queryKey: ['members', orgId],
		queryFn: () =>
			api<{ id: string; name: string }[]>('/manage/members', {
				organizationId: orgId,
			}),
	});
	const save = useMutation({
		mutationFn: (body: unknown) =>
			api(
				requestId
					? `/manage/requests/${requestId}`
					: `/manage/customers/${customerId}/requests`,
				{ method: requestId ? 'PUT' : 'POST', body, organizationId: orgId }
			),
		onSuccess: () => {
			void cache.invalidateQueries({
				queryKey: ['customer', orgId, customerId],
			});
			void cache.invalidateQueries({ queryKey: ['customers', orgId] });
			onClose();
		},
	});
	const notify = useMutation({
		mutationFn: () =>
			api(`/manage/requests/${requestId}/notify`, {
				method: 'POST',
				body: {},
				organizationId: orgId,
			}),
		onSuccess: () => {
			setConfirmSend(false);
			void cache.invalidateQueries({ queryKey: ['request', orgId, requestId] });
		},
	});
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		save.mutate({
			title: data.get('title'),
			description: data.get('description'),
			internalNotes: data.get('internalNotes'),
			status: data.get('status'),
			assigneeId: data.get('assigneeId') || null,
			completionNote: data.get('completionNote'),
			slackUrl: data.get('slackUrl') || null,
			notifyOnDone:
				data.get('notifyOnDone') === 'inherit'
					? null
					: data.get('notifyOnDone') === 'on',
		});
	}
	const row = query.data;
	return (
		<Modal
			title={requestId ? 'Request details' : 'New request'}
			onClose={onClose}
			wide>
			{(requestId && query.isPending) || members.isPending ? (
				<Loading variant='form' />
			) : query.error || members.error ? (
				<Message error>
					{query.error?.message ?? members.error?.message}
				</Message>
			) : (
				<form className='form-stack' onSubmit={submit}>
					<Field label='Title'>
						<input
							name='title'
							defaultValue={row?.title}
							placeholder='Request title'
							required
							maxLength={240}
						/>
					</Field>
					<div className='form-grid'>
						<Field label='Status'>
							<select name='status' defaultValue={row?.status ?? 'todo'}>
								{statuses.map((s) => (
									<option value={s} key={s}>
										{statusLabels[s]}
									</option>
								))}
							</select>
						</Field>
						<Field label='Assigned to'>
							<select name='assigneeId' defaultValue={row?.assigneeId ?? ''}>
								<option value=''>Unassigned</option>
								{row?.assigneeId &&
									!members.data?.some((m) => m.id === row.assigneeId) && (
										<option value={row.assigneeId} disabled>
											Former teammate — choose a new assignee
										</option>
									)}
								{members.data?.map((m) => (
									<option key={m.id} value={m.id}>
										{m.name}
									</option>
								))}
							</select>
						</Field>
					</div>
					<Field label='Description' hint='Visible to the customer.'>
						<textarea
							name='description'
							rows={4}
							defaultValue={row?.description}
							placeholder='Describe the request…'
							maxLength={20000}
						/>
					</Field>
					<Field label='Internal notes' hint='Only your team can see this.'>
						<textarea
							name='internalNotes'
							rows={3}
							defaultValue={row?.internalNotes}
							placeholder='Notes for your team…'
							maxLength={20000}
						/>
					</Field>
					<div className='form-section'>
						<h3>Slack notification</h3>
						<Field
							label='Original Slack thread'
							hint='Copy the link to the original message at the top of the thread. Add the Vows bot to the channel first.'>
							<input
								name='slackUrl'
								type='url'
								defaultValue={row?.slackUrl ?? ''}
								placeholder='https://your-team.slack.com/archives/…'
							/>
						</Field>
						<Field label='Notify customer when done'>
							<select
								name='notifyOnDone'
								defaultValue={
									row?.notifyOnDone == null
										? 'inherit'
										: row.notifyOnDone
											? 'on'
											: 'off'
								}>
								<option value='inherit'>Use workspace setting</option>
								<option value='on'>Notify in original thread</option>
								<option value='off'>Don’t notify</option>
							</select>
						</Field>
						<Field
							label='Completion note'
							hint='Visible to the customer and included in the Slack notification.'>
							<textarea
								name='completionNote'
								rows={2}
								defaultValue={row?.completionNote}
								placeholder='Tell the customer what’s ready…'
								maxLength={3000}
							/>
						</Field>
						{row?.deliveries.map((d) => (
							<div className='delivery-row' key={d.id}>
								<span className={`delivery-state delivery-${d.status}`}>
									{d.status}
								</span>
								<span>
									{d.lastError ||
										(d.sentAt
											? `Sent ${dateLabel(d.sentAt)}`
											: 'Completion update')}
								</span>
							</div>
						))}
						{row?.status === 'done' && row.slackUrl && (
							<div className='resend-box'>
								{confirmSend ? (
									<>
										<p className='small muted'>
											This sends another update using the saved request. Check
											the Slack thread first if a previous delivery is
											uncertain.
										</p>
										<button
											type='button'
											className='button'
											disabled={notify.isPending}
											onClick={() => notify.mutate()}>
											Confirm send
										</button>
										<button
											type='button'
											className='text-button'
											onClick={() => setConfirmSend(false)}>
											Cancel
										</button>
									</>
								) : (
									<button
										type='button'
										className='button'
										onClick={() => setConfirmSend(true)}>
										Send update to thread
									</button>
								)}
							</div>
						)}
						{notify.error && <Message error>{notify.error.message}</Message>}
						{notify.isSuccess && <Message>Update queued.</Message>}
					</div>
					{row?.events && row.events.length > 0 && (
						<details className='history'>
							<summary>Status history</summary>
							{row.events.map((e) => (
								<div key={e.id}>
									<span>
										{e.fromStatus
											? `${statusLabels[e.fromStatus]} → `
											: 'Created as '}
										{statusLabels[e.toStatus]}
									</span>
									<time>{dateLabel(e.createdAt)}</time>
								</div>
							))}
						</details>
					)}
					{save.error && <Message error>{save.error.message}</Message>}
					<div className='form-actions'>
						<button type='button' className='button' onClick={onClose}>
							Cancel
						</button>
						<button className='button primary' disabled={save.isPending}>
							{save.isPending
								? 'Saving…'
								: requestId
									? 'Save changes'
									: 'Create request'}
						</button>
					</div>
				</form>
			)}
		</Modal>
	);
}
