/** @type {import('next').NextConfig} */
const nextConfig = {
	async rewrites() {
		const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3101').replace(
			/\/$/,
			''
		);
		return [
			{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
			{ source: '/mcp', destination: `${apiUrl}/mcp` },
			{
				source: '/.well-known/oauth-protected-resource/mcp',
				destination: `${apiUrl}/.well-known/oauth-protected-resource/mcp`,
			},
		];
	},
};

export default nextConfig;
