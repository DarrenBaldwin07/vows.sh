'use client';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Loading, Message } from '@/components/ui';
type Integrations = {
	slack: {
		id: string;
		name: string;
		notifyOnDone: boolean;
		disconnectedAt: string | null;
	} | null;
	configured: boolean;
};
export default function IntegrationsPage() {
	const { orgId, orgRole } = useAuth();
	const cache = useQueryClient();
	const isAdmin = orgRole === 'org:admin';
	const query = useQuery({
		queryKey: ['integrations', orgId],
		queryFn: () =>
			api<Integrations>('/manage/integrations', { organizationId: orgId }),
		enabled: Boolean(orgId),
	});
	const change = useMutation({
		mutationFn: ({ method, body }: { method: string; body?: unknown }) =>
			api('/manage/integrations/slack', {
				method,
				body: body ?? {},
				organizationId: orgId,
			}),
		onSuccess: () => {
			void cache.invalidateQueries({ queryKey: ['integrations', orgId] });
		},
	});
	const connected = query.data?.slack && !query.data.slack.disconnectedAt;
	return (
		<>
			<div className='topbar'>
				<h1 className='topbar-title'>Integrations</h1>
			</div>
			<div className='page-content'>
				{query.isPending ? (
					<Loading variant='card' />
				) : query.error ? (
					<Message error>{query.error.message}</Message>
				) : (
					<div className='integration-card'>
						<div className='integration-heading'>
							<span className='slack-mark'>
								<Image src='/slack.svg' width={28} height={28} alt='' />
							</span>
							<div>
								<h2>Slack</h2>
								<p>
									{connected
										? `Connected to ${query.data?.slack?.name}`
										: 'Completion notifications'}
								</p>
							</div>
							<span
								className={`connection-badge ${connected ? 'connected' : ''}`}>
								{connected ? 'Connected' : 'Not connected'}
							</span>
						</div>
						<p className='muted'>
							When a request is done, send an update in the original Slack
							thread.
						</p>
						{connected ? (
							<>
								<label
									className='toggle-row'
									htmlFor='notify-on-done'
									aria-label='Notify customers when requests are done'>
									<div>
										<strong>Notify customers when requests are done</strong>
										<p>
											Requests inherit this setting. You can override it for
											each request.
										</p>
									</div>
									<input
										type='checkbox'
										id='notify-on-done'
										checked={query.data?.slack?.notifyOnDone ?? false}
										disabled={!isAdmin || change.isPending}
										onChange={(e) =>
											change.mutate({
												method: 'PATCH',
												body: { notifyOnDone: e.target.checked },
											})
										}
									/>
								</label>
								<div className='integration-instructions'>
									<strong>To link a request</strong>
									<ol>
										<li>Add the Vows bot to the customer’s Slack channel.</li>
										<li>
											Copy the original message link and paste it into the
											request.
										</li>
										<li>Add a completion note, then mark the request Done.</li>
									</ol>
									<p className='small muted'>
										Use a conversation your customer can already access. Direct
										messages aren’t supported in this release.
									</p>
								</div>
								{isAdmin && (
									<button
										className='button'
										disabled={change.isPending}
										onClick={() => change.mutate({ method: 'DELETE' })}>
										Disconnect Slack
									</button>
								)}
							</>
						) : isAdmin && query.data?.configured ? (
							<button
								onClick={() =>
									window.location.assign(
										`/api/manage/slack/connect?organizationId=${encodeURIComponent(orgId!)}`
									)
								}
								className='button primary'>
								Connect Slack <ExternalLink size={14} aria-hidden='true' />
							</button>
						) : (
							<Message>
								{isAdmin
									? 'Slack connection is not available on this deployment yet. Contact the deployment owner to enable it.'
									: 'Ask a workspace admin to connect Slack.'}
							</Message>
						)}
						{change.error && <Message error>{change.error.message}</Message>}
					</div>
				)}
			</div>
		</>
	);
}
