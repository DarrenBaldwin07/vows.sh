'use client';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Field, Loading, Message } from './ui';

type Settings = { internalDomain: string | null };
export function InternalDomainSettings() {
	const { orgId } = useAuth();
	const cache = useQueryClient();
	const queryKey = ['workspace-settings', orgId];
	const query = useQuery({
		queryKey,
		queryFn: () => api<Settings>('/manage/settings', { organizationId: orgId }),
	});
	const save = useMutation({
		mutationFn: (internalDomain: string | null) =>
			api<Settings>('/manage/settings', {
				method: 'PATCH',
				body: { internalDomain },
				organizationId: orgId,
			}),
		onSuccess: (settings) => {
			cache.setQueryData(queryKey, settings);
			void cache.invalidateQueries({ queryKey: ['sharing', orgId] });
		},
	});
	return (
		<section className='settings-section'>
			<h2>Internal portal access</h2>
			<p className='muted small'>
				Anyone signed in with a verified email at this exact domain can access
				every enabled customer portal in this workspace. This includes existing
				and future portals. Leave blank to turn off internal domain access.
			</p>
			{query.isPending ? (
				<Loading variant='form' />
			) : query.error ? (
				<Message error>{query.error.message}</Message>
			) : (
				<form
					className='settings-name-form'
					onSubmit={(event) => {
						event.preventDefault();
						const value = String(
							new FormData(event.currentTarget).get('internalDomain') ?? ''
						).trim();
						save.mutate(value || null);
					}}>
					<Field label='Internal domain'>
						<input
							key={query.data.internalDomain ?? ''}
							name='internalDomain'
							defaultValue={query.data.internalDomain ?? ''}
							placeholder='company.com'
							maxLength={255}
							autoCapitalize='none'
							spellCheck={false}
							disabled={save.isPending}
							onChange={() => save.reset()}
						/>
					</Field>
					<button className='button' disabled={save.isPending}>
						{save.isPending ? 'Saving…' : 'Save changes'}
					</button>
				</form>
			)}
			{save.error && <Message error>{save.error.message}</Message>}
			{save.isSuccess && (
				<Message>Internal domain updated for all customer portals.</Message>
			)}
		</section>
	);
}
