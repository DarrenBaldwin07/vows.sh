/** @type {import('next').NextConfig} */
const nextConfig = {
	// Keep the database's filesystem-based environment loading in Node.js.
	serverExternalPackages: ['@repo/db'],
};

export default nextConfig;
