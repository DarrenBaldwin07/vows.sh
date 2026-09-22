import {
	ClerkProvider,
	Show,
	SignInButton,
	SignUpButton,
	UserButton,
} from '@clerk/nextjs';
import { shadcn } from '@clerk/ui/themes';
import { Button } from '@repo/ui/components/button';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Providers } from './providers';

const geistSans = localFont({
	src: './fonts/GeistVF.woff',
	variable: '--font-geist-sans',
});
const geistMono = localFont({
	src: './fonts/GeistMonoVF.woff',
	variable: '--font-geist-mono',
});

export const metadata: Metadata = {
	title: 'Hello World',
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang='en'>
			<body className={`${geistSans.variable} ${geistMono.variable}`}>
				<ClerkProvider appearance={{ theme: shadcn }}>
					<Providers>
						<header className='flex h-16 items-center justify-end border-b px-6'>
							<nav aria-label='Account' className='flex items-center gap-3'>
								<Show when='signed-out'>
									<SignInButton>
										<Button variant='ghost'>Sign in</Button>
									</SignInButton>
									<SignUpButton>
										<Button>Sign up</Button>
									</SignUpButton>
								</Show>
								<Show when='signed-in'>
									<UserButton />
								</Show>
							</nav>
						</header>
						{children}
					</Providers>
				</ClerkProvider>
			</body>
		</html>
	);
}
