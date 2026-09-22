'use client';

import Image from 'next/image';
import { useState, type ChangeEvent } from 'react';
import { InitialBadge } from './initial-badge';

export function CustomerImage({
	id,
	name,
	imageData,
}: {
	id?: string;
	name?: string;
	imageData?: string | null;
}) {
	const [failed, setFailed] = useState<string | null>(null);
	return imageData && imageData !== failed ? (
		<Image
			className='customer-image'
			src={imageData}
			alt=''
			width={36}
			height={36}
			unoptimized
			onError={() => setFailed(imageData)}
		/>
	) : (
		<InitialBadge id={id} name={name} />
	);
}

export function CustomerImageUpload({
	defaultValue,
	name,
	onProcessingChange,
}: {
	defaultValue?: string | null;
	name?: string;
	onProcessingChange: (busy: boolean) => void;
}) {
	const [value, setValue] = useState(defaultValue ?? '');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	async function upload(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (!file) return;
		setError('');
		if (
			!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
			file.size > 10 * 1024 * 1024
		) {
			setError('Choose a PNG, JPEG, or WebP image up to 10 MB.');
			return;
		}
		setBusy(true);
		onProcessingChange(true);
		try {
			const bitmap = await createImageBitmap(file);
			const canvas = document.createElement('canvas');
			const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
			canvas.width = Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			const context = canvas.getContext('2d');
			if (!context) {
				bitmap.close();
				throw new Error('Image processing unavailable.');
			}
			context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			bitmap.close();
			const data = canvas.toDataURL('image/png');
			if (data.length > 350000)
				throw new Error('Image is too large. Try a smaller image.');
			setValue(data);
		} catch {
			setError('Could not read this image. Try another PNG, JPEG, or WebP.');
		} finally {
			setBusy(false);
			onProcessingChange(false);
		}
	}
	return (
		<div className='customer-image-upload'>
			<span className='field-caption'>Customer image</span>
			<div className='customer-image-upload-controls'>
				<CustomerImage name={name} imageData={value} />
				<label className='button customer-image-picker'>
					{busy ? 'Processing…' : value ? 'Change image' : 'Upload image'}
					<input
						type='file'
						accept='image/png,image/jpeg,image/webp'
						aria-label='Upload customer image'
						disabled={busy}
						onChange={upload}
					/>
				</label>
				{value && (
					<button
						type='button'
						className='text-button'
						disabled={busy}
						onClick={() => {
							setValue('');
							setError('');
						}}>
						Remove
					</button>
				)}
			</div>
			<input type='hidden' name='imageData' value={value} />
			<p className='small muted'>
				PNG, JPEG, or WebP. Up to 10 MB; resized before saving.
			</p>
			{error && (
				<p className='notice notice-error' role='alert'>
					{error}
				</p>
			)}
		</div>
	);
}
