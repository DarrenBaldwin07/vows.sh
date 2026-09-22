import { auth } from '@clerk/nextjs/server';
import { CustomerPortal } from '@/components/customer-portal';
export default async function SharePage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	await auth.protect();
	const { token } = await params;
	return <CustomerPortal token={token} />;
}
