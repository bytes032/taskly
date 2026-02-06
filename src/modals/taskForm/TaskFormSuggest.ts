import { AbstractInputSuggest, App } from "obsidian";
import TasklyPlugin from "../../main";

/**
 * Tag suggestion object for compatibility with other plugins
 */
interface TagSuggestion {
	value: string;
	display: string;
	type: "tag";
	toString(): string;
}

/**
 * Tag suggestion provider using AbstractInputSuggest
 */
export class TagSuggest extends AbstractInputSuggest<TagSuggestion> {
	private plugin: TasklyPlugin;
	private input: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement, plugin: TasklyPlugin) {
		super(app, inputEl);
		this.plugin = plugin;
		this.input = inputEl;
	}

	protected async getSuggestions(_: string): Promise<TagSuggestion[]> {
		// Handle comma-separated values
		const currentValues = this.input.value.split(",").map((v: string) => v.trim());
		const currentQuery = currentValues[currentValues.length - 1];

		if (!currentQuery) return [];

		const tags = this.plugin.cacheManager.getAllTags();
		return tags
			.filter((tag) => tag && typeof tag === "string")
			.filter(
				(tag) =>
					tag.toLowerCase().includes(currentQuery.toLowerCase()) &&
					!currentValues.slice(0, -1).includes(tag)
			)
			.slice(0, 10)
			.map((tag) => ({
				value: tag,
				display: tag,
				type: "tag" as const,
				toString() {
					return this.value;
				},
			}));
	}

	public renderSuggestion(tagSuggestion: TagSuggestion, el: HTMLElement): void {
		el.textContent = tagSuggestion.display;
	}

	public selectSuggestion(tagSuggestion: TagSuggestion): void {
		const currentValues = this.input.value.split(",").map((v: string) => v.trim());
		currentValues[currentValues.length - 1] = tagSuggestion.value;
		this.input.value = currentValues.join(", ") + ", ";

		// Trigger input event to update internal state
		this.input.dispatchEvent(new Event("input", { bubbles: true }));
		this.input.focus();
	}
}

/**
 * User field suggestion object
 */
interface UserFieldSuggestion {
	value: string;
	display: string;
	type: "user-field";
	fieldKey: string;
	toString(): string;
}

/**
 * User field suggestion provider using AbstractInputSuggest
 */
export class UserFieldSuggest extends AbstractInputSuggest<UserFieldSuggestion> {
	private plugin: TasklyPlugin;
	private input: HTMLInputElement;
	private fieldConfig: any; // UserMappedField from settings

	constructor(app: App, inputEl: HTMLInputElement, plugin: TasklyPlugin, fieldConfig: any) {
		super(app, inputEl);
		this.plugin = plugin;
		this.input = inputEl;
		this.fieldConfig = fieldConfig;
	}

	protected async getSuggestions(_: string): Promise<UserFieldSuggestion[]> {
		const isListField = this.fieldConfig.type === "list";

		// Get current token or full value
		let currentQuery = "";
		let currentValues: string[] = [];
		if (isListField) {
			currentValues = this.input.value.split(",").map((v: string) => v.trim());
			currentQuery = currentValues[currentValues.length - 1] || "";
		} else {
			currentQuery = this.input.value.trim();
		}
		if (!currentQuery) return [];

		// Detect wikilink trigger [[... and delegate to file suggester
		const wikiMatch = currentQuery.match(/\[\[([^\]]*)$/);
		if (wikiMatch) {
			const partial = wikiMatch[1] || "";
			const { FileSuggestHelper } = await import("../../suggest/FileSuggestHelper");
			// Apply custom field filter if configured, otherwise show all files
			const list = await FileSuggestHelper.suggest(
				this.plugin,
				partial,
				20,
				this.fieldConfig.autosuggestFilter
			);
			return list.map((item) => ({
				value: item.insertText,
				display: item.displayText,
				type: "user-field" as const,
				fieldKey: this.fieldConfig.key,
				toString() {
					return this.value;
				},
			}));
		}

		// Fallback to existing-values suggestion
		const existingValues = await this.getExistingUserFieldValues(this.fieldConfig.key);
		return existingValues
			.filter((value) => value && typeof value === "string")
			.filter(
				(value) =>
					value.toLowerCase().includes(currentQuery.toLowerCase()) &&
					(!isListField || !currentValues.slice(0, -1).includes(value))
			)
			.slice(0, 10)
			.map((value) => ({
				value: value,
				display: value,
				type: "user-field" as const,
				fieldKey: this.fieldConfig.key,
				toString() {
					return this.value;
				},
			}));
	}

	private async getExistingUserFieldValues(fieldKey: string): Promise<string[]> {
		const run = async (): Promise<string[]> => {
			try {
				// Get all files and extract unique values for this field
				const allFiles = this.plugin.app.vault.getMarkdownFiles();
				const values = new Set<string>();

				// Process all files, but with early termination for performance
				for (const file of allFiles) {
					try {
						const metadata = this.plugin.app.metadataCache.getFileCache(file);
						const frontmatter = metadata?.frontmatter;

						if (frontmatter && frontmatter[fieldKey] !== undefined) {
							const value = frontmatter[fieldKey];

							if (Array.isArray(value)) {
								// Handle list fields
								value.forEach((v) => {
									if (typeof v === "string" && v.trim()) {
										values.add(v.trim());
									}
								});
							} else if (typeof value === "string" && value.trim()) {
								values.add(value.trim());
							} else if (typeof value === "number") {
								values.add(value.toString());
							} else if (typeof value === "boolean") {
								values.add(value.toString());
							}
						}

						// Early termination: stop after finding many unique values for performance
						// This ensures we get comprehensive suggestions without processing every file
						if (values.size >= 200) {
							break;
						}
					} catch (error) {
						// Skip files with errors
						continue;
					}
				}

				return Array.from(values).sort();
			} catch (error) {
				console.error("Error getting user field values:", error);
				return [];
			}
		};

		// Use debouncing for performance in large vaults (same pattern as FileSuggestHelper)
		const debounceMs = this.plugin.settings?.suggestionDebounceMs ?? 0;
		if (!debounceMs) {
			return run();
		}

		return new Promise<string[]>((resolve) => {
			const anyPlugin = this.plugin as unknown as { __userFieldSuggestTimer?: number };
			if (anyPlugin.__userFieldSuggestTimer) {
				clearTimeout(anyPlugin.__userFieldSuggestTimer);
			}
			anyPlugin.__userFieldSuggestTimer = setTimeout(async () => {
				const results = await run();
				resolve(results);
			}, debounceMs) as unknown as number;
		});
	}

	public renderSuggestion(suggestion: UserFieldSuggestion, el: HTMLElement): void {
		el.textContent = suggestion.display;
	}

	public selectSuggestion(suggestion: UserFieldSuggestion): void {
		const isListField = this.fieldConfig.type === "list";

		if (isListField) {
			// Replace last token with the selected suggestion. If user is typing a
			// wikilink region ([[...), replace that partial region; otherwise
			// replace the token entirely with the suggestion value.
			const parts = this.input.value.split(",");
			const last = parts.pop() ?? "";
			const before = parts.join(",");
			const trimmed = last.trim();
			const replacement = /\[\[/.test(trimmed)
				? trimmed.replace(/\[\[[^\]]*$/, `[[${suggestion.value}]]`)
				: suggestion.value;
			const rebuilt = (before ? before + ", " : "") + replacement;
			this.input.value = rebuilt.endsWith(",") ? rebuilt + " " : rebuilt + ", ";
		} else {
			// Replace the active [[... region or entire value
			const val = this.input.value;
			const replaced = val.replace(/\[\[[^\]]*$/, `[[${suggestion.value}]]`);
			this.input.value = replaced === val ? suggestion.value : replaced;
		}

		// Trigger input event to update internal state
		this.input.dispatchEvent(new Event("input", { bubbles: true }));
		this.input.focus();
	}
}
