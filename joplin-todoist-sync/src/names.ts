// Matching of the `##Project` and `@@Label` tokens typed in a note against
// the account's project and label names (SPEC.md section 3.5).

export type NameMatch =
	| { kind: 'match'; name: string }
	| { kind: 'none' }
	| { kind: 'ambiguous'; candidates: string[] };

// Case, spaces, dashes and underscores are ignored when matching.
function normalize(name: string): string {
	return name.toLowerCase().replace(/[\s\-_]+/g, '');
}

// Finds the one name `token` refers to. An exact match wins, then a single
// name that starts with the token, then a single name that contains it.
// More than one match at the same step is ambiguous, never a guess.
export function matchName(token: string, names: string[]): NameMatch {
	const wanted = normalize(token);
	if (!wanted) return { kind: 'none' };

	const unique = Array.from(new Set(names));
	const steps: Array<(name: string) => boolean> = [
		name => name === wanted,
		name => name.startsWith(wanted),
		name => name.includes(wanted),
	];

	for (const step of steps) {
		const found = unique.filter(name => step(normalize(name)));
		if (found.length === 1) return { kind: 'match', name: found[0] };
		if (found.length > 1) return { kind: 'ambiguous', candidates: found };
	}

	return { kind: 'none' };
}
