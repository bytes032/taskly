import type { FileFilterConfig } from "../../suggest/FileSuggestHelper";
import { createCardInput } from "./CardComponent";

/**
 * Creates filter settings inputs (tags, folders, property key/value)
 * Reusable across file suggestion filters and custom field filters
 */
export function createFilterSettingsInputs(
	container: HTMLElement,
	currentConfig: FileFilterConfig | undefined,
	onChange: (updated: FileFilterConfig) => void
): void {
	// Track current config state to preserve values across sequential updates
	let config = currentConfig || {
		requiredTags: [],
		includeFolders: [],
		propertyKey: "",
		propertyValue: "",
	};

	// Helper to update config and trigger onChange
	const updateConfig = (updates: Partial<FileFilterConfig>) => {
		config = { ...config, ...updates };
		onChange(config);
	};

	// Required Tags input
	const tagsInput = createCardInput(
		"text",
		"tag1, tag2",
		config.requiredTags?.join(", ") || ""
	);
	tagsInput.addEventListener("change", () => {
		const tags = tagsInput.value
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		updateConfig({ requiredTags: tags });
	});

	// Include Folders input
	const foldersInput = createCardInput(
		"text",
		"Work/, Personal",
		config.includeFolders?.join(", ") || ""
	);
	foldersInput.addEventListener("change", () => {
		const folders = foldersInput.value
			.split(",")
			.map((f) => f.trim())
			.filter(Boolean);
		updateConfig({ includeFolders: folders });
	});

	// Property Key input
	const keyInput = createCardInput(
		"text",
		"type",
		config.propertyKey || ""
	);
	keyInput.addEventListener("change", () => {
		updateConfig({ propertyKey: keyInput.value.trim() });
	});

	// Property Value input
	const valueInput = createCardInput(
		"text",
		"value",
		config.propertyValue || ""
	);
	valueInput.addEventListener("change", () => {
		updateConfig({ propertyValue: valueInput.value.trim() });
	});

	// Create rows
	const createRow = (label: string, input: HTMLElement) => {
		const row = container.createDiv("taskly-settings__card-config-row");
		const labelEl = row.createSpan("taskly-settings__card-config-label");
		labelEl.textContent = label;
		row.appendChild(input);
	};

	createRow("Required tags", tagsInput);
	createRow(
		"Include folders",
		foldersInput
	);
	createRow(
		"Required property key",
		keyInput
	);
	createRow(
		"Required property value",
		valueInput
	);
}
