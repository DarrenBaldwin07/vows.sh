import { auth } from '@clerk/nextjs/server';
import { Shell } from '@/components/shell';
export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await auth.protect();
	return <Shell>{children}</Shell>;
}
