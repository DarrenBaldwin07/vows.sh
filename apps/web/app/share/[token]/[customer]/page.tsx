import { SignIn } from '@clerk/nextjs';
import { portalMetadata } from '@/lib/portal-metadata';
import { auth } from '@clerk/nextjs/server';
import { CustomerPortal } from '@/components/customer-portal';

// The first segment shares its parameter name with the legacy /share/:token route.
export async function generateMetadata({
	params,
}: {
	params: Promise<{ token: string; customer: string }>;
}) {
	const values = await params;
	return portalMetadata([values.token, values.customer]);
}

export default async function ReadableSharePage({
	params,
}: {
	params: Promise<{ token: string; customer: string }>;
}) {
	const { userId } = await auth();
	const { token: workspace, customer } = await params;
	if (!userId)
		return (
			<div className='flex min-h-screen items-center justify-center'>
				<SignIn
					routing='hash'
					forceRedirectUrl={`/share/${[workspace, customer].map(encodeURIComponent).join('/')}`}
				/>
			</div>
		);
	return <CustomerPortal address={{ workspace, customer }} />;
}
