'use client';
import { useOrganization, useOrganizationList } from '@clerk/nextjs';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { clerkError } from '@/lib/clerk-error';
import { Dropdown } from './dropdown';
import { WorkspaceLogo } from './workspace-logo';
import { Field, Loading, Message, Modal } from './ui';

export function WorkspaceSwitcher() {
	const { organization } = useOrganization();
	const { isLoaded, setActive, userMemberships, userInvitations } =
		useOrganizationList({
			userMemberships: { infinite: true, pageSize: 20 },
			userInvitations: { infinite: true, pageSize: 20, status: 'pending' },
		});
	const router = useRouter();
	const [creating, setCreating] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	async function select(
		id: string,
		close: () => void,
		accept?: () => Promise<unknown>
	) {
		if (!setActive || busy) return;
		setBusy(true);
		setError('');
		try {
			if (accept) await accept();
			await setActive({ organization: id });
			close();
			router.push('/customers');
			router.refresh();
		} catch (e) {
			setError(clerkError(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<Dropdown
				label='Switch workspace'
				trigger={
					<>
						<WorkspaceLogo organization={organization} />
						<span className='truncate'>
							{organization?.name ?? 'Select workspace'}
						</span>
						<ChevronsUpDown
							size={13}
							className='dropdown-chevron'
							aria-hidden='true'
						/>
					</>
				}>
				{(close) => (
					<>
						<div className='dropdown-caption'>Workspaces</div>
						{!isLoaded || userMemberships.isLoading ? (
							<Loading variant='menu' rows={3} />
						) : (
							userMemberships.data?.map((m) => (
								<button
									key={m.id}
									className='dropdown-item'
									disabled={busy}
									onClick={() => void select(m.organization.id, close)}>
									<WorkspaceLogo organization={m.organization} />
									<span className='truncate'>{m.organization.name}</span>
									{organization?.id === m.organization.id && (
										<Check
											size={14}
											className='dropdown-chevron'
											aria-hidden='true'
										/>
									)}
								</button>
							))
						)}
						{userMemberships.hasNextPage && (
							<button
								className='dropdown-item'
								disabled={userMemberships.isFetching}
								onClick={() => userMemberships.fetchNext()}>
								Load more workspaces
							</button>
						)}
						{userInvitations.data?.map((invitation) => (
							<button
								key={invitation.id}
								className='dropdown-item'
								disabled={busy}
								onClick={() =>
									void select(invitation.publicOrganizationData.id, close, () =>
										invitation.accept()
									)
								}>
								<WorkspaceLogo
									organization={invitation.publicOrganizationData}
								/>
								<span>Join {invitation.publicOrganizationData.name}</span>
							</button>
						))}
						{userInvitations.hasNextPage && (
							<button
								className='dropdown-item'
								disabled={userInvitations.isFetching}
								onClick={() => userInvitations.fetchNext()}>
								Load more invitations
							</button>
						)}
						<div className='dropdown-separator' />
						<button
							className='dropdown-item'
							disabled={!isLoaded || busy}
							onClick={() => {
								close();
								setCreating(true);
							}}>
							<Plus size={14} aria-hidden='true' />
							Create workspace
						</button>
						{(error || userMemberships.error || userInvitations.error) && (
							<Message error>
								{error ||
									clerkError(userMemberships.error ?? userInvitations.error)}
							</Message>
						)}
					</>
				)}
			</Dropdown>
			{creating && <CreateWorkspace onClose={() => setCreating(false)} />}
		</>
	);
}

function CreateWorkspace({ onClose }: { onClose: () => void }) {
	const { isLoaded, createOrganization, setActive, userMemberships } =
		useOrganizationList({ userMemberships: true });
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [createdId, setCreatedId] = useState<string | null>(null);
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!createOrganization || !setActive || busy) return;
		const name = String(
			new FormData(event.currentTarget).get('name') ?? ''
		).trim();
		if (!name && !createdId) return;
		setBusy(true);
		setError('');
		try {
			const id = createdId ?? (await createOrganization({ name })).id;
			setCreatedId(id);
			await userMemberships.revalidate?.();
			await setActive({ organization: id });
			onClose();
			router.push('/customers');
			router.refresh();
		} catch (e) {
			setError(clerkError(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<Modal title='Create workspace' onClose={onClose}>
			<form className='form-stack' onSubmit={submit}>
				<Field label='Workspace name'>
					<input
						name='name'
						placeholder='Acme'
						required
						maxLength={160}
						disabled={Boolean(createdId)}
					/>
				</Field>
				{error && <Message error>{error}</Message>}
				<div className='form-actions'>
					<button type='button' className='button' onClick={onClose}>
						Cancel
					</button>
					<button className='button primary' disabled={!isLoaded || busy}>
						{busy
							? 'Creating…'
							: createdId
								? 'Open workspace'
								: 'Create workspace'}
					</button>
				</div>
			</form>
		</Modal>
	);
}
