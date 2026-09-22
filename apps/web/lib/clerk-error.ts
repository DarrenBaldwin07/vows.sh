export function clerkError(error: unknown) {
	if (
		typeof error === 'object' &&
		error !== null &&
		'errors' in error &&
		Array.isArray(error.errors)
	) {
		const first = error.errors[0];
		if (typeof first?.longMessage === 'string') return first.longMessage;
		if (typeof first?.message === 'string') return first.message;
	}
	return error instanceof Error
		? error.message
		: 'Something went wrong. Please try again.';
}
