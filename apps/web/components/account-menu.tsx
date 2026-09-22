'use client';
import { useClerk, useUser } from '@clerk/nextjs';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { useState, type FormEvent, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CustomerImage } from './customer-image';
import { clerkError } from '@/lib/clerk-error';
import { Dropdown } from './dropdown';
import { Field, Message, Modal } from './ui';

export function AccountMenu({ upward = false }: { upward?: boolean }) {
	const { user } = useUser();
	const cache = useQueryClient();
	const [photoMessage, setPhotoMessage] = useState('');
	const { signOut } = useClerk();
	const [editing, setEditing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const name =
		user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Account';
	async function updatePhoto(file: File | null) {
		if (!user || busy) return;
		setError('');
		setPhotoMessage('');
		if (
			file &&
			(!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
				file.size > 5 * 1024 * 1024)
		) {
			setError('Choose a PNG, JPEG, or WebP image up to 5 MB.');
			return;
		}
		setBusy(true);
		try {
			await user.setProfileImage({ file });
			await user.reload();
			void cache.invalidateQueries({ queryKey: ['portal'] });
			setPhotoMessage(file ? 'Profile photo saved.' : 'Profile photo removed.');
		} catch (e) {
			setError(clerkError(e));
		} finally {
			setBusy(false);
		}
	}
	function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (file) void updatePhoto(file);
	}

	async function logout() {
		setBusy(true);
		setError('');
		try {
			await signOut({ redirectUrl: '/sign-in' });
		} catch (e) {
			setError(clerkError(e));
		} finally {
			setBusy(false);
		}
	}
	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!user || busy) return;
		const form = new FormData(event.currentTarget);
		setBusy(true);
		setError('');
		try {
			await user.update({
				firstName: String(form.get('firstName')).trim(),
				lastName: String(form.get('lastName')).trim(),
			});
			setEditing(false);
		} catch (e) {
			setError(clerkError(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<Dropdown
				label='Account menu'
				upward={upward}
				align={upward ? 'left' : 'right'}
				trigger={
					<>
						<span className='account-avatar'>
							<CustomerImage
								id={user?.id}
								name={name}
								imageData={user?.hasImage ? user.imageUrl : null}
							/>
						</span>
						<span className='truncate'>{name}</span>
						<ChevronDown
							size={13}
							className='dropdown-chevron'
							aria-hidden='true'
						/>
					</>
				}>
				{(close) => (
					<>
						<div className='dropdown-caption'>
							{user?.primaryEmailAddress?.emailAddress}
						</div>
						<button
							className='dropdown-item'
							onClick={() => {
								close();
								setError('');
								setPhotoMessage('');
								setEditing(true);
							}}>
							<UserRound size={14} aria-hidden='true' />
							Account settings
						</button>
						<button className='dropdown-item' disabled={busy} onClick={logout}>
							<LogOut size={14} aria-hidden='true' />
							{busy ? 'Signing out…' : 'Sign out'}
						</button>
						{error && !editing && <Message error>{error}</Message>}
					</>
				)}
			</Dropdown>
			{editing && (
				<Modal title='Account settings' onClose={() => setEditing(false)}>
					<form className='form-stack' onSubmit={save}>
						<div className='profile-photo-field'>
							<span className='field-caption'>Profile photo</span>
							<div className='profile-photo-controls'>
								<CustomerImage
									id={user?.id}
									name={name}
									imageData={user?.hasImage ? user.imageUrl : null}
								/>
								<label className='button customer-image-picker'>
									{busy
										? 'Saving…'
										: user?.hasImage
											? 'Change photo'
											: 'Upload photo'}
									<input
										type='file'
										accept='image/png,image/jpeg,image/webp'
										aria-label='Upload profile photo'
										disabled={busy || !user}
										onChange={choosePhoto}
									/>
								</label>
								{user?.hasImage && (
									<button
										type='button'
										className='text-button'
										disabled={busy}
										onClick={() => void updatePhoto(null)}>
										Remove
									</button>
								)}
							</div>
							<p className='small muted'>
								Shown beside requests assigned to you in customer portals.
								Photos save immediately.
							</p>
							{photoMessage && <Message>{photoMessage}</Message>}
						</div>
						<div className='form-grid'>
							<Field label='First name'>
								<input
									name='firstName'
									defaultValue={user?.firstName ?? ''}
									maxLength={100}
								/>
							</Field>
							<Field label='Last name'>
								<input
									name='lastName'
									defaultValue={user?.lastName ?? ''}
									maxLength={100}
								/>
							</Field>
						</div>
						<Field label='Email address'>
							<input
								readOnly
								value={user?.primaryEmailAddress?.emailAddress ?? ''}
							/>
						</Field>
						{error && <Message error>{error}</Message>}
						<div className='form-actions'>
							<button
								type='button'
								className='button'
								onClick={() => setEditing(false)}>
								Cancel
							</button>
							<button className='button primary' disabled={busy || !user}>
								{busy ? 'Saving…' : 'Save changes'}
							</button>
						</div>
					</form>
				</Modal>
			)}
		</>
	);
}
