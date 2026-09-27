'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Field, Message } from './ui';
export type LinearLink = {
	url: string;
	identifier: string;
	stateName: string;
	disconnectedAt: string | null;
};
export function LinearIssueLink({
	requestId,
	customerId,
	organizationId,
	link,
}: {
	requestId: string;
	customerId: string;
	organizationId: string | null | undefined;
	link: LinearLink | null;
}) {
	const [url, setUrl] = useState(link?.url ?? '');
	const cache = useQueryClient();
	const mutation = useMutation({
		mutationFn: (method: 'POST' | 'DELETE') =>
			api(`/manage/requests/${requestId}/linear`, {
				method,
				body: { url },
				organizationId,
			}),
		onSuccess: (_, method) => {
			if (method === 'DELETE') setUrl('');
			void cache.invalidateQueries({
				queryKey: ['request', organizationId, requestId],
			});
			void cache.invalidateQueries({
				queryKey: ['customer', organizationId, customerId],
			});
			void cache.invalidateQueries({ queryKey: ['customers', organizationId] });
			void cache.invalidateQueries({ queryKey: ['request-events'] });
		},
	});
	return (
		<div className='form-section'>
			<h3>Linear issue</h3>
			<p className='muted small'>
				Link an existing issue to sync its status to this request. Linking
				applies the issue’s current status immediately.
			</p>
			{link && (
				<p className='small'>
					<a
						href={link.url}
						target='_blank'
						rel='noreferrer'
						className='text-button'>
						{link.identifier}
					</a>{' '}
					· {link.stateName}
					{link.disconnectedAt && ' · Sync disconnected'}
				</p>
			)}
			<Field label='Linear issue URL'>
				<input
					type='url'
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					placeholder='https://linear.app/team/issue/ENG-123/title'
					maxLength={2000}
				/>
			</Field>
			<div className='linear-link-actions'>
				<button
					className='button'
					type='button'
					disabled={mutation.isPending || !url.trim()}
					onClick={() => mutation.mutate('POST')}>
					{mutation.isPending ? 'Saving…' : link ? 'Update link' : 'Link issue'}
				</button>
				{link && (
					<button
						className='button'
						type='button'
						disabled={mutation.isPending}
						onClick={() => mutation.mutate('DELETE')}>
						Unlink
					</button>
				)}
			</div>
			{mutation.error && <Message error>{mutation.error.message}</Message>}
			{mutation.isSuccess && <Message>Linear link updated.</Message>}
		</div>
	);
}
