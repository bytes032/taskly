/* eslint-disable @typescript-eslint/no-non-null-assertion */
// Tag rendering utilities following Taskly coding standards

export interface TagServices {
	// Tags are now non-clickable, this interface is kept for future extensibility
}

/** Render a single tag string as an Obsidian-like tag element */
export function renderTag(container: HTMLElement, tag: string, services?: TagServices): void {
	if (!tag || typeof tag !== "string") return;

	const normalized = normalizeTag(tag);
	if (!normalized) return;

	// Use span for non-interactive tags (no click handler)
	const el = container.createEl("span", {
		cls: "tag",
		text: normalized,
	});
}

/** Render a list or single tag value into a container */
export function renderTagsValue(
	container: HTMLElement,
	value: unknown,
	services?: TagServices
): void {
	if (typeof value === "string") {
		renderTag(container, value, services);
		return;
	}
	if (Array.isArray(value)) {
		const validTags = value
			.flat(2)
			.filter((t) => t !== null && t !== undefined && typeof t === "string");

		validTags.forEach((t, idx) => {
			if (idx > 0) container.appendChild(document.createTextNode(" "));
			renderTag(container, String(t), services);
		});
		return;
	}
	// Fallback: not a recognizable tag value
	if (value != null) container.appendChild(document.createTextNode(String(value)));
}

/**
 * Normalize arbitrary tag strings into #tag form
 * Enhanced to handle spaces and special characters including Unicode
 */
export function normalizeTag(raw: string): string | null {
	if (!raw || typeof raw !== "string") return null;
	const s = raw.trim();
	if (!s) return null;

	// Clean input: keep Unicode word chars, hyphens, and slashes for hierarchical tags
	// Use \p{L} (Unicode letters), \p{N} (Unicode numbers), and _ (underscore)
	const hasPrefix = s.startsWith("#");
	const cleaned = s.replace(/[^\p{L}\p{N}_#/-]/gu, "");

	if (hasPrefix) {
		return cleaned.length > 1 ? cleaned : null;
	}

	return cleaned ? `#${cleaned}` : null;
}
