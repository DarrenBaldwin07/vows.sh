import type { Metadata } from 'next';

export async function portalMetadata(segments: string[]): Promise<Metadata> {
	const locator = segments.map(encodeURIComponent).join('/');
	const apiOrigin = process.env.API_URL ?? 'http://127.0.0.1:3101';
	const origin = process.env.APP_URL ?? 'http://localhost:3100';
	try {
		const response = await fetch(
			new URL(`/api/portal-preview/${locator}`, apiOrigin),
			{ cache: 'no-store' }
		);
		if (!response.ok) return { title: 'Customer portal' };
		const preview: { name: string; hasImage: boolean } = await response.json();
		const title = `${preview.name} · Customer portal`;
		const description = 'Sign in to view your requests, progress, and updates.';
		const images = preview.hasImage
			? [
					{
						url: new URL(`/api/portal-preview/${locator}?image=1`, origin).href,
						alt: `${preview.name} logo`,
					},
				]
			: [];
		return {
			title,
			description,
			openGraph: { title, description, type: 'website', images },
			twitter: { card: 'summary', title, description, images },
		};
	} catch {
		return { title: 'Customer portal' };
	}
}
