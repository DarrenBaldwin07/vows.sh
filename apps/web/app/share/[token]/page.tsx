import { SignIn } from '@clerk/nextjs';
import { portalMetadata } from '@/lib/portal-metadata';
import { auth } from '@clerk/nextjs/server';
import { CustomerPortal } from '@/components/customer-portal';
export async function generateMetadata({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const values = await params;
	return portalMetadata([values.token]);
}

export default async function SharePage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { userId } = await auth();
	const { token } = await params;
	if (!userId)
		return (
			<div className='flex min-h-screen items-center justify-center'>
				<SignIn
					routing='hash'
					forceRedirectUrl={`/share/${encodeURIComponent(token)}`}
				/>
			</div>
		);
	return <CustomerPortal token={token} />;
}
