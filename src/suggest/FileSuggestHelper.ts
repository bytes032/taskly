import type TasklyPlugin from "../main";
import { parseFrontMatterAliases } from "obsidian";
import { scoreMultiword } from "../utils/fuzzyMatch";
import { FilterUtils } from "../utils/FilterUtils";

export interface FileSuggestionItem {
	insertText: string; // usually basename
	displayText: string; // "basename [title: ... | aliases: ...]"
	score: number;
}

/**
 * Generic file filter configuration.
 * Can be used for custom field filters or any other filtering needs.
 * If undefined, no filtering is applied (all files are considered).
 */
export interface FileFilterConfig {
	requiredTags?: string[];
	includeFolders?: string[];
	propertyKey?: string;
	propertyValue?: string;
}

export const FileSuggestHelper = {
	async suggest(
		plugin: TasklyPlugin,
		query: string,
		limit = 20,
		filterConfig?: FileFilterConfig
	): Promise<FileSuggestionItem[]> {
		const run = async () => {
			const files = plugin?.app?.vault?.getMarkdownFiles
				? plugin.app.vault.getMarkdownFiles()
				: [];
			const items: FileSuggestionItem[] = [];

			// Get filtering settings - only apply if filterConfig is provided
			const requiredTags = filterConfig?.requiredTags ?? [];
			const includeFolders = filterConfig?.includeFolders ?? [];
			const propertyKey = filterConfig?.propertyKey?.trim() || "";
			const propertyValue = filterConfig?.propertyValue?.trim() || "";

			for (const file of files) {
				const cache = plugin.app.metadataCache.getFileCache(file);

				// Apply tag filtering if configured
				if (requiredTags.length > 0) {
					// Get tags from both native tag detection and frontmatter
					const nativeTags = cache?.tags?.map((t) => t.tag.replace("#", "")) || [];
					const frontmatterTags = cache?.frontmatter?.tags || [];
					const allTags = [
						...nativeTags,
						...(Array.isArray(frontmatterTags)
							? frontmatterTags
							: [frontmatterTags].filter(Boolean)),
					];

					// Check if file has ANY of the required tags using hierarchical matching with proper exclusion handling
					const hasRequiredTag = FilterUtils.matchesTagConditions(allTags, requiredTags);
					if (!hasRequiredTag) {
						continue; // Skip this file
					}
				}

				// Apply folder filtering if configured
				if (includeFolders.length > 0) {
					const isInIncludedFolder = includeFolders.some(
						(folder) =>
							file.path.startsWith(folder) || file.path.startsWith(folder + "/")
					);
					if (!isInIncludedFolder) {
						continue; // Skip this file
					}
				}

				// Apply property filtering if configured
				if (propertyKey) {
					const frontmatter = cache?.frontmatter;
					const rawValue = frontmatter ? (frontmatter as any)[propertyKey] : undefined;
					if (rawValue === undefined || rawValue === null) {
						continue;
					}
					if (propertyValue) {
						if (Array.isArray(rawValue)) {
							const values = rawValue.map((v) => String(v));
							if (!values.includes(propertyValue)) {
								continue;
							}
						} else if (String(rawValue) !== propertyValue) {
							continue;
						}
					}
				}

				// Gather fields
				const basename = file.basename;
				let title = "";
				if (cache?.frontmatter) {
					const mapped = plugin.fieldMapper.mapFromFrontmatter(
						cache.frontmatter,
						file.path,
						plugin.settings.storeTitleInFilename
					);
					title = typeof mapped.title === "string" ? mapped.title : "";
				}
				const aliases = cache?.frontmatter
					? parseFrontMatterAliases(cache.frontmatter) || []
					: [];

				// Compute score: keep best among fields to rank the file
				let bestScore = 0;
				bestScore = Math.max(bestScore, scoreMultiword(query, basename) + 15); // basename weight
				if (title) bestScore = Math.max(bestScore, scoreMultiword(query, title) + 5);
				if (Array.isArray(aliases)) {
					for (const a of aliases) {
						if (typeof a === "string") {
							bestScore = Math.max(bestScore, scoreMultiword(query, a));
						}
					}
				}

				if (bestScore > 0) {
					// Build display
					const extras: string[] = [];
					if (title && title !== basename) extras.push(`title: ${title}`);
					const aliasList = Array.isArray(aliases)
						? aliases.filter((a) => typeof a === "string")
						: [];
					if (aliasList.length) extras.push(`aliases: ${aliasList.join(", ")}`);
					const display = extras.length
						? `${basename} [${extras.join(" | ")}]`
						: basename;

					items.push({ insertText: basename, displayText: display, score: bestScore });
				}
			}

			// Sort and cap
			items.sort((a, b) => b.score - a.score);
			// Deduplicate by insertText (basename)
			const out: FileSuggestionItem[] = [];
			const seen = new Set<string>();
			for (const it of items) {
				if (seen.has(it.insertText)) continue;
				out.push(it);
				seen.add(it.insertText);
				if (out.length >= limit) break;
			}
			return out;
		};

		return run();
	},
};
