'use client';

import Image from 'next/image';
import { useState } from 'react';
import { InitialBadge } from './initial-badge';

type WorkspaceImage = {
	id: string;
	name: string;
	imageUrl?: string;
	hasImage?: boolean;
};

export function WorkspaceLogo({
	organization,
	showLoadingSkeleton = false,
}: {
	organization?: WorkspaceImage | null;
	showLoadingSkeleton?: boolean;
}) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
	const url = organization?.hasImage ? organization.imageUrl : undefined;
	if (!url || failedUrl === url)
		return <InitialBadge id={organization?.id} name={organization?.name} />;
	const loading = showLoadingSkeleton && loadedUrl !== url;
	const image = (
		<Image
			key={url}
			className='workspace-logo'
			src={url}
			alt=''
			width={48}
			height={48}
			unoptimized
			style={loading ? { opacity: 0 } : undefined}
			onLoad={() => setLoadedUrl(url)}
			onError={() => setFailedUrl(url)}
		/>
	);
	if (!showLoadingSkeleton) return image;
	return (
		<span className='workspace-logo-frame' aria-busy={loading}>
			{loading && <span className='skeleton' aria-hidden='true' />}
			{image}
		</span>
	);
}
