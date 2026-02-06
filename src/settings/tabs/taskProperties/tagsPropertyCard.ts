import TasklyPlugin from "../../../main";
import {
	createCard,
	createCardInput,
	CardRow,
} from "../../components/CardComponent";
import { createNLPTriggerRows, createPropertyDescription } from "./helpers";

/**
 * Renders the Tags property card (special - uses native Obsidian tags, no property key)
 */
export function renderTagsPropertyCard(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	const defaultInput = createCardInput(
		"text",
		"important, urgent",
		plugin.settings.taskCreationDefaults.defaultTags
	);

	defaultInput.addEventListener("change", () => {
		plugin.settings.taskCreationDefaults.defaultTags = defaultInput.value;
		save();
	});

	const nlpRows = createNLPTriggerRows(plugin, "tags", "#", save);

	// Create description element
	const descriptionEl = createPropertyDescription(
		"Native Obsidian tags for categorizing tasks. These are stored in the tags frontmatter property and work with Obsidian's tag features."
	);

	const rows: CardRow[] = [
		{ label: "", input: descriptionEl, fullWidth: true },
		{ label: "Default:", input: defaultInput },
		...nlpRows,
	];

	createCard(container, {
		id: "property-tags",
		collapsible: true,
		defaultCollapsed: true,
		header: {
			primaryText: "Tags",
			secondaryText: "Uses native Obsidian tags",
		},
		content: {
			sections: [{ rows }],
		},
	});
}
