import {
	autocompletion,
	CompletionContext,
	CompletionResult,
	Completion,
	acceptCompletion,
	moveCompletionSelection,
	closeCompletion
} from "@codemirror/autocomplete";
import { Extension, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import TasklyPlugin from "../main";
import { NaturalLanguageParser } from "../services/NaturalLanguageParser";
import { TriggerConfigService } from "../services/TriggerConfigService";
import { FileSuggestHelper } from "../suggest/FileSuggestHelper";

/**
 * CodeMirror autocomplete extension for NLP triggers with configurable trigger support
 *
 * Supports customizable triggers for:
 * - Tags (default: #, uses native suggester when #)
 * - Status (default: *)
 * - User-defined properties
 *
 * Note: [[ wikilink autocomplete uses Obsidian's native suggester
 *
 * Replaces the old NLPSuggest system for use with EmbeddableMarkdownEditor
 */
export function createNLPAutocomplete(plugin: TasklyPlugin): Extension[] {
	const autocomplete = autocompletion({
		override: [
			async (context: CompletionContext): Promise<CompletionResult | null> => {
				// Initialize trigger config service
				const triggerConfig = new TriggerConfigService(
					plugin.settings.nlpTriggers,
					plugin.settings.userFields || []
				);

				// Get text before cursor
				const line = context.state.doc.lineAt(context.pos);
				const textBeforeCursor = line.text.slice(0, context.pos - line.from);

				// Helper: check if index is at a word boundary
				const isBoundary = (index: number, text: string) => {
					if (index === -1) return false;
					if (index === 0) return true;
					const prev = text[index - 1];
					return !/\w/.test(prev);
				};

				// Find all enabled triggers and their positions
				const enabledTriggers = triggerConfig.getTriggersOrderedByLength();
				const candidates: Array<{
					propertyId: string;
					trigger: string;
					index: number;
					triggerLength: number;
				}> = [];

				for (const triggerDef of enabledTriggers) {
					// Skip native tag suggester (# trigger) - Obsidian handles that
					if (triggerDef.propertyId === "tags" && triggerDef.trigger === "#") {
						continue;
					}

					const lastIndex = textBeforeCursor.lastIndexOf(triggerDef.trigger);
					if (isBoundary(lastIndex, textBeforeCursor)) {
						candidates.push({
							propertyId: triggerDef.propertyId,
							trigger: triggerDef.trigger,
							index: lastIndex,
							triggerLength: triggerDef.trigger.length,
						});
					}
				}

				if (candidates.length === 0) return null;

				// Sort by position (most recent first)
				candidates.sort((a, b) => b.index - a.index);
				const active = candidates[0];

				// Extract query after trigger
				const queryStart = active.index + active.triggerLength;
				const query = textBeforeCursor.slice(queryStart);

				const suggesterType = triggerConfig.getSuggesterType(active.propertyId);
				const allowSpaces = suggesterType === "file";

				// Don't suggest if there's a space (except for file-based suggester which allows multi-word)
				if (!allowSpaces && (query.includes(" ") || query.includes("\n"))) {
					return null;
				}

				// Get suggestions based on property type
				const options = await getSuggestionsForProperty(
					active.propertyId,
					query,
					plugin,
					triggerConfig
				);

				// Return null if no options (let native suggesters handle their triggers)
				if (!options || options.length === 0) {
					return null;
				}

				const from = line.from + active.index + active.triggerLength;
				const to = context.pos;

				return {
					from,
					to,
					options,
					validFor: /^[\w\s-]*$/,
				};
			},
		],
		// Show autocomplete immediately when typing after trigger
		activateOnTyping: true,
		// Close on blur
		closeOnBlur: true,
		// Max options to show
		maxRenderedOptions: 10,
		// No custom rendering needed for simplified suggestions
	});

	// Add explicit keyboard navigation for autocomplete with high priority
	// This ensures our autocomplete takes precedence over Obsidian's native ones
	const autocompleteKeymap = Prec.high(
		keymap.of([
			{ key: "ArrowDown", run: moveCompletionSelection(true) },
			{ key: "ArrowUp", run: moveCompletionSelection(false) },
			{ key: "Enter", run: acceptCompletion },
			{ key: "Tab", run: acceptCompletion },
			{ key: "Escape", run: closeCompletion },
		])
	);

	return [Prec.high(autocomplete), autocompleteKeymap];
}

/**
 * Get autocomplete suggestions for a specific property
 */
async function getSuggestionsForProperty(
	propertyId: string,
	query: string,
	plugin: TasklyPlugin,
	triggerConfig: TriggerConfigService
): Promise<Completion[] | null> {
	const suggesterType = triggerConfig.getSuggesterType(propertyId);

	switch (suggesterType) {
		case "list":
			return getListSuggestions(propertyId, query, plugin);

		case "file":
			return getFileSuggestions(propertyId, query, plugin, triggerConfig);

		case "status":
			return getStatusSuggestions(query, plugin);

		case "boolean":
			return getBooleanSuggestions(query);

		case "native-tag":
			// Native tag suggester handles this
			return null;

		default:
			return null;
	}
}

/**
 * Get list-based suggestions (tags or simple text lists)
 */
function getListSuggestions(
	propertyId: string,
	query: string,
	plugin: TasklyPlugin
): Completion[] {
	let items: string[] = [];
	let label: string = propertyId;

	switch (propertyId) {
		case "tags":
			items = plugin.cacheManager.getAllTags();
			label = "Tag";
			break;

		default:
			// User-defined list field - would need to fetch values from cache
			// For now, return empty
			items = [];
			label = propertyId;
			break;
	}

	return items
		.filter((item) => item && typeof item === "string")
		.filter((item) => item.toLowerCase().includes(query.toLowerCase()))
		.slice(0, 10)
		.map((item) => ({
			label: item,
			apply: item + " ",
			type: "text",
			info: label,
		}));
}

/**
 * Get file-based suggestions (user fields with autosuggest)
 */
async function getFileSuggestions(
	propertyId: string,
	query: string,
	plugin: TasklyPlugin,
	triggerConfig: TriggerConfigService
): Promise<Completion[]> {
	try {
		// Get autosuggest config from user field
		const userField = triggerConfig.getUserField(propertyId);
		const autosuggestConfig = userField?.autosuggestFilter;

		const excluded = (plugin.settings.excludedFolders || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const list = await FileSuggestHelper.suggest(plugin, query, 20, autosuggestConfig);

		// Filter out excluded folders
		const filteredList = list.filter((item) => {
			const file = plugin.app.vault
				.getMarkdownFiles()
				.find((f) => f.basename === item.insertText);
			if (!file) return true;
			return !excluded.some((ex) => file.path.startsWith(ex));
		});

		return filteredList.map((item) => {
			const displayText = item.displayText || item.insertText;
			const insertText = item.insertText;

			return {
				label: displayText,
				apply: `[[${insertText}]] `,
				type: "text",
				info: propertyId,
			};
		});
	} catch (error) {
		console.error(`Error getting file suggestions for ${propertyId}:`, error);
		return [];
	}
}

/**
 * Get status suggestions
 */
function getStatusSuggestions(query: string, plugin: TasklyPlugin): Completion[] {
	const parser = NaturalLanguageParser.fromPlugin(plugin);
	const statusSuggestions = parser.getStatusSuggestions(query, 10);

	return statusSuggestions.map((s) => ({
		label: s.display,
		apply: s.value + " ",
		type: "text",
		info: "Status",
	}));
}

/**
 * Get boolean suggestions (true/false)
 */
function getBooleanSuggestions(query: string): Completion[] {
	const options = ["true", "false"];

	return options
		.filter((opt) => opt.toLowerCase().includes(query.toLowerCase()))
		.map((opt) => ({
			label: opt,
			apply: opt + " ",
			type: "text",
			info: "Boolean",
		}));
}
