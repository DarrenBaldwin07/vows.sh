import { RE2JS } from 're2js';

export function compileEmailPattern(pattern: string) {
	if (!pattern.length || pattern.length > 500)
		throw new Error(
			'Email patterns must contain between 1 and 500 characters.'
		);
	return RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
}

export function matchesEmailAccess(
	access: {
		kind: 'email' | 'domain' | 'regex';
		email: string;
		clerkUserId: string | null;
	},
	user: { userId: string; verifiedEmails: string[] }
) {
	if (
		access.kind === 'email' &&
		access.clerkUserId &&
		access.clerkUserId !== user.userId
	)
		return false;
	try {
		const pattern =
			access.kind === 'regex' ? compileEmailPattern(access.email) : null;
		return user.verifiedEmails.some((value) => {
			if (value.length > 320) return false;
			const email = value.toLowerCase();
			if (access.kind === 'email') return email === access.email;
			if (access.kind === 'domain')
				return (
					email.split('@').length === 2 && email.split('@')[1] === access.email
				);
			return pattern!.matches(email);
		});
	} catch {
		// An invalid stored rule must never grant access or break other rules.
		return false;
	}
}
