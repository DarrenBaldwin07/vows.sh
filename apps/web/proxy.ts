import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
const protectedPage = createRouteMatcher([
	'/customers(.*)',
	'/integrations(.*)',
	'/settings(.*)',
	'/share(.*)',
]);
export default clerkMiddleware(async (auth, request) => {
	if (protectedPage(request)) await auth.protect();
});
export const config = {
	matcher: [
		'/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
		'/(api|trpc)(.*)',
	],
};
