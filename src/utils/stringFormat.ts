export function formatString(
	template: string,
	params?: Record<string, string | number | boolean | null | undefined>
): string {
	if (!params) return template;

	return template.replace(/\{(\w+)\}/g, (_match, key) => {
		if (Object.prototype.hasOwnProperty.call(params, key)) {
			return String(params[key] ?? "");
		}
		return `{${key}}`;
	});
}
