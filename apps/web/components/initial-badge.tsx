const badgeColors = [
	'#5266a3',
	'#8062a5',
	'#b16b42',
	'#a65773',
	'#537c94',
	'#75695c',
];

export function InitialBadge({ id, name }: { id?: string; name?: string }) {
	// Keep the assigned color stable across renders, renames, and sessions.
	const hash = Array.from(id ?? '').reduce(
		(value, character) =>
			(Math.imul(value, 31) + character.codePointAt(0)!) >>> 0,
		0
	);
	return (
		<span
			className='initial-badge'
			aria-hidden='true'
			style={{
				backgroundColor: id
					? badgeColors[hash % badgeColors.length]
					: '#737373',
			}}>
			{Array.from(name?.trim() ?? '')[0]?.toLocaleUpperCase() ?? '?'}
		</span>
	);
}
