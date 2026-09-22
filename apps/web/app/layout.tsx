import { ClerkProvider } from '@clerk/nextjs';
import { shadcn } from '@clerk/ui/themes';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Providers } from './providers';
import './globals.css';
const geistSans = localFont({
	src: './fonts/GeistVF.woff',
	variable: '--font-geist-sans',
});
const geistMono = localFont({
	src: './fonts/GeistMonoVF.woff',
	variable: '--font-geist-mono',
});
export const metadata: Metadata = {
	title: { default: 'Vows', template: '%s · Vows' },
	description: 'Customer request tracking.',
	robots: { index: false, follow: false },
	referrer: 'no-referrer',
};
export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang='en'>
			<body className={`${geistSans.variable} ${geistMono.variable}`}>
				<ClerkProvider
					appearance={{ theme: shadcn }}
					localization={{
						signIn: {
							start: {
								title: 'Sign in to Vows',
								subtitle: 'Sign in to continue.',
							},
						},
						signUp: {
							start: {
								title: 'Create your Vows account',
								subtitle: 'Create an account to continue.',
							},
						},
					}}
					signInUrl='/sign-in'
					signUpUrl='/sign-up'
					signInFallbackRedirectUrl='/customers'
					signUpFallbackRedirectUrl='/customers'>
					<Providers>{children}</Providers>
				</ClerkProvider>
			</body>
		</html>
	);
}
