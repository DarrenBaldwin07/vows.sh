'use client';
import { Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Field, Loading, Message, Modal } from './ui';
type Sharing = {
	link: { id: string; token: string; path: string } | null;
	access: { id: string; email: string; accepted: boolean }[];
};
export function SharingDialog({
	customerId,
	onClose,
}: {
	customerId: string;
	onClose: () => void;
}) {
	const { orgId } = useAuth();
	const cache = useQueryClient();
	const [message, setMessage] = useState('');
	const path = `/manage/customers/${customerId}`;
	const query = useQuery({
		queryKey: ['sharing', orgId, customerId],
		queryFn: () => api<Sharing>(`${path}/sharing`, { organizationId: orgId }),
	});
	const change = useMutation({
		mutationFn: ({
			suffix,
			method,
			body,
		}: {
			suffix: string;
			method: string;
			body?: unknown;
		}) =>
			api<{ path?: string }>(`${path}/${suffix}`, {
				method,
				body: body ?? {},
				organizationId: orgId,
			}),
		onSuccess: () => {
			void cache.invalidateQueries({
				queryKey: ['sharing', orgId, customerId],
			});
		},
	});
	const link = query.data?.link
		? `${typeof window !== 'undefined' ? window.location.origin : ''}${query.data.link.path}`
		: '';
	async function copy() {
		try {
			await navigator.clipboard.writeText(link);
			setMessage('Link copied. Share it with the people listed below.');
		} catch {
			setMessage('Select the link below and copy it manually.');
		}
	}
	function addAccess(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		change.mutate(
			{
				suffix: 'access',
				method: 'POST',
				body: { email: new FormData(form).get('email') },
			},
			{ onSuccess: () => form.reset() }
		);
	}
	return (
		<Modal title='Share customer portal' onClose={onClose}>
			<div className='form-stack'>
				<p className='muted'>
					Customers must sign in with one of the verified email addresses below.
				</p>
				{query.isPending ? (
					<Loading variant='form' />
				) : query.error ? (
					<Message error>{query.error.message}</Message>
				) : (
					<>
						<div className='share-link-box'>
							<span className='field-caption'>Customer link</span>
							{link ? (
								<>
									<div className='input-action'>
										<input
											readOnly
											aria-label='Customer portal link'
											value={link}
											onFocus={(e) => e.target.select()}
										/>
										<button className='button' onClick={copy}>
											<Copy size={14} aria-hidden='true' /> Copy link
										</button>
									</div>
									<form
										className='portal-address-form'
										key={query.data!.link!.path}
										onSubmit={(event) => {
											event.preventDefault();
											const form = new FormData(event.currentTarget);
											change.mutate(
												{
													suffix: 'sharing',
													method: 'PATCH',
													body: {
														workspaceSlug: form.get('workspaceSlug'),
														customerSlug: form.get('customerSlug'),
													},
												},
												{
													onSuccess: () =>
														setMessage(
															'Link updated. Previously shared links still work.'
														),
												}
											);
										}}>
										<div className='form-grid'>
											<Field label='Workspace URL name'>
												<input
													name='workspaceSlug'
													required
													maxLength={60}
													pattern='[a-z0-9]+(-[a-z0-9]+)*'
													defaultValue={query.data!.link!.path.split('/')[2]}
												/>
											</Field>
											<Field label='Customer URL name'>
												<input
													name='customerSlug'
													required
													maxLength={60}
													pattern='[a-z0-9]+(-[a-z0-9]+)*'
													defaultValue={query.data!.link!.path.split('/')[3]}
												/>
											</Field>
										</div>
										<p className='small muted'>
											Use lowercase letters, numbers, and hyphens. These names
											stay the same when you rename a customer. Changing the
											workspace URL name also sets the default for future links.
										</p>
										<button className='button' disabled={change.isPending}>
											Save URL
										</button>
									</form>
									<div className='link-actions'>
										<button
											disabled={change.isPending}
											onClick={() => {
												setMessage('');
												change.mutate({ suffix: 'sharing', method: 'POST' });
											}}>
											Replace link
										</button>
										<button
											disabled={change.isPending}
											onClick={() => {
												setMessage('');
												change.mutate({ suffix: 'sharing', method: 'DELETE' });
											}}>
											Disable sharing
										</button>
									</div>
									<small className='muted'>
										Replacing or disabling the link makes the current link stop
										working.
									</small>
								</>
							) : (
								<button
									className='button primary'
									disabled={change.isPending}
									onClick={() =>
										change.mutate({ suffix: 'sharing', method: 'POST' })
									}>
									Enable sharing
								</button>
							)}
						</div>
						<div>
							<h3>People with access</h3>
							<p className='muted small'>
								Adding an address grants access; share the portal link with them
								directly.
							</p>
							{query.data?.access.map((person) => (
								<div className='access-row' key={person.id}>
									<span>
										{person.email}
										<small>
											{person.accepted ? 'Has visited' : 'Not visited yet'}
										</small>
									</span>
									<button
										className='button small-button'
										disabled={change.isPending}
										onClick={() =>
											change.mutate({
												suffix: `access/${person.id}`,
												method: 'DELETE',
											})
										}>
										Remove
									</button>
								</div>
							))}
							<form onSubmit={addAccess} className='input-action access-form'>
								<Field label='Email address'>
									<input
										type='email'
										name='email'
										required
										placeholder='person@acme.com'
									/>
								</Field>
								<button className='button' disabled={change.isPending}>
									Add person
								</button>
							</form>
						</div>
					</>
				)}
				{change.error && <Message error>{change.error.message}</Message>}
				{message && <Message>{message}</Message>}
			</div>
		</Modal>
	);
}
