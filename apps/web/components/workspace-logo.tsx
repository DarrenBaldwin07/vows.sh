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
}: {
	organization?: WorkspaceImage | null;
}) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const url = organization?.hasImage ? organization.imageUrl : undefined;
	if (!url || failedUrl === url)
		return <InitialBadge id={organization?.id} name={organization?.name} />;
	return (
		<Image
			className='workspace-logo'
			src={url}
			alt=''
			width={48}
			height={48}
			unoptimized
			onError={() => setFailedUrl(url)}
		/>
	);
}
