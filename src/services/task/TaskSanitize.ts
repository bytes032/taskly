export function sanitizeTitleForFilename(input: string): string {
	if (!input || typeof input !== "string") {
		return "untitled";
	}

	try {
		// Remove or replace problematic characters
		let sanitized = input
			.trim()
			// Replace multiple spaces with single space
			.replace(/\s+/g, " ")
			// Remove characters that are problematic in filenames and content
			.replace(/[<>:"/\\|?*#[\]]/g, "")
			// Remove control characters separately
			.replace(/./g, (char) => {
				const code = char.charCodeAt(0);
				return code <= 31 || (code >= 127 && code <= 159) ? "" : char;
			})
			// Remove leading/trailing dots
			.replace(/^\.+|\.+$/g, "")
			// Final trim in case we removed characters at the edges
			.trim();

		// Additional validation
		if (!sanitized || sanitized.length === 0) {
			sanitized = "untitled";
		}

		return sanitized;
	} catch (error) {
		console.error("Error sanitizing title:", error);
		return "untitled";
	}
}

export function sanitizeTitleForStorage(input: string): string {
	if (!input || typeof input !== "string") {
		return "untitled";
	}

	try {
		let sanitized = input
			.trim()
			// Replace multiple spaces with single space
			.replace(/\s+/g, " ")
			// Remove control characters only
			.replace(/./g, (char) => {
				const code = char.charCodeAt(0);
				return code <= 31 || (code >= 127 && code <= 159) ? "" : char;
			})
			// Final trim in case we removed characters at the edges
			.trim();

		// Additional validation
		if (!sanitized || sanitized.length === 0) {
			sanitized = "untitled";
		}

		return sanitized;
	} catch (error) {
		console.error("Error sanitizing title:", error);
		return "untitled";
	}
}
