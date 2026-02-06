import { splitListPreservingLinksAndQuotes } from "../../utils/stringSplit";

/**
 * Normalize list-type user field values from frontmatter into comparable tokens
 * - Splits comma-separated strings: "a, b" -> ["a","b"]
 * - Extracts display text from wikilinks: [[file|Alias]] -> "Alias"; [[People/Chuck Norris]] -> "Chuck Norris"
 * - Also includes the raw token (e.g., "[[Chuck Norris]]") for exact-match scenarios
 */
export function normalizeUserListValue(raw: any): string[] {
	const tokens: string[] = [];
	const pushToken = (s: string) => {
		if (!s) return;
		const trimmed = String(s).trim();
		if (!trimmed) return;
		const m = trimmed.match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
		if (m) {
			const target = m[1] || "";
			const alias = m[2];
			const base = alias || target.split("#")[0].split("/").pop() || target;
			if (base) tokens.push(base);
			tokens.push(trimmed); // keep raw as fallback
			return;
		}
		tokens.push(trimmed);
	};

	if (Array.isArray(raw)) {
		for (const v of raw) pushToken(String(v));
	} else if (typeof raw === "string") {
		const parts = splitListPreservingLinksAndQuotes(raw);
		for (const p of parts) pushToken(p);
	} else if (raw != null) {
		pushToken(String(raw));
	}

	// Deduplicate while preserving order
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of tokens) {
		if (!seen.has(t)) {
			seen.add(t);
			out.push(t);
		}
	}
	return out;
}
