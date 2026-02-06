import { Setting } from "obsidian";
import TasklyPlugin from "../../../main";
import {
	createCard,
	createStatusBadge,
	createCardInput,
	createDeleteHeaderButton,
	showCardEmptyState,
	createCardSelect,
	createCardToggle,
	CardRow,
} from "../../components/CardComponent";
import { createFilterSettingsInputs } from "../../components/FilterSettingsComponent";
import { createNLPTriggerRows } from "./helpers";
import { UserMappedField } from "../../../types/settings";

/**
 * Creates the appropriate default value input based on field type
 */
function createDefaultValueInput(
	field: UserMappedField,
	onChange: (value: string | number | boolean | string[] | undefined) => void
): { element: HTMLElement; row: CardRow } {
	let inputElement: HTMLElement;
	let row: CardRow;

	if (field.type === "boolean") {
		// Boolean field uses a toggle
		const currentValue = typeof field.defaultValue === "boolean" ? field.defaultValue : false;
		inputElement = createCardToggle(currentValue, (value) => {
			onChange(value);
		});
		row = {
			label: "Default Value:",
			input: inputElement,
		};
	} else if (field.type === "number") {
		// Number field uses number input
		const input = createCardInput(
			"number",
			"Default value",
			field.defaultValue !== undefined ? String(field.defaultValue) : ""
		);
		input.addEventListener("change", () => {
			const value = input.value.trim();
			if (value === "") {
				onChange(undefined);
			} else {
				onChange(parseFloat(value));
			}
		});
		inputElement = input;
		row = {
			label: "Default Value:",
			input: inputElement,
		};
	} else if (field.type === "date") {
		// Date field uses a dropdown with preset options (same as due defaults)
		const currentValue = typeof field.defaultValue === "string" ? field.defaultValue : "none";
		const select = createCardSelect(
			[
				{ value: "none", label: "None" },
				{ value: "today", label: "Today" },
				{ value: "tomorrow", label: "Tomorrow" },
				{ value: "next-week", label: "Next week" },
			],
			currentValue
		);
		select.addEventListener("change", () => {
			const value = select.value;
			onChange(value === "none" ? undefined : value);
		});
		inputElement = select;
		row = {
			label: "Default Value:",
			input: inputElement,
		};
	} else if (field.type === "list") {
		// List field uses text input with comma-separated values
		const currentValue = Array.isArray(field.defaultValue)
			? field.defaultValue.join(", ")
			: "";
		const input = createCardInput(
			"text",
			"Default values (comma-separated)",
			currentValue
		);
		input.addEventListener("change", () => {
			const value = input.value.trim();
			if (value === "") {
				onChange(undefined);
			} else {
				onChange(value.split(",").map(v => v.trim()).filter(v => v));
			}
		});
		inputElement = input;
		row = {
			label: "Default Value:",
			input: inputElement,
		};
	} else {
		// Text field uses text input
		const input = createCardInput(
			"text",
			"Default value",
			typeof field.defaultValue === "string" ? field.defaultValue : ""
		);
		input.addEventListener("change", () => {
			const value = input.value.trim();
			onChange(value === "" ? undefined : value);
		});
		inputElement = input;
		row = {
			label: "Default Value:",
			input: inputElement,
		};
	}

	return { element: inputElement, row };
}

/**
 * Renders the user fields section with add button
 */
export function renderUserFieldsSection(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	// Ensure user fields array exists
	if (!Array.isArray(plugin.settings.userFields)) {
		plugin.settings.userFields = [];
	}

	// User fields list - using card layout
	const userFieldsContainer = container.createDiv("taskly-user-fields-container");
	renderUserFieldsList(userFieldsContainer, plugin, save);

	// Add user field button
	new Setting(container)
		.setName("Add new user field")
		.setDesc("Create a new custom field that will appear in filters and views")
		.addButton((button) =>
			button
				.setButtonText(
					"Add user field"
				)
				.onClick(async () => {
					if (!plugin.settings.userFields) {
						plugin.settings.userFields = [];
					}
					const newId = `field_${Date.now()}`;
					const newField = {
						id: newId,
						displayName: "",
						key: "",
						type: "text" as const,
					};
					plugin.settings.userFields.push(newField);

					save();
					renderUserFieldsList(userFieldsContainer, plugin, save);
				})
		);
}

/**
 * Renders the list of user field cards with NLP triggers
 * @param expandedFieldId - Optional field ID to keep expanded after re-render
 */
function renderUserFieldsList(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void,
	expandedFieldId?: string
): void {
	container.empty();

	if (!plugin.settings.userFields) {
		plugin.settings.userFields = [];
	}

	if (plugin.settings.userFields.length === 0) {
		showCardEmptyState(
			container,
			"No custom user fields configured. Add a field to create custom properties for your tasks.",
			"Add User Field",
			() => {
				const addUserFieldButton = document.querySelector(
					'[data-setting-name="Add new user field"] button'
				);
				if (addUserFieldButton) {
					(addUserFieldButton as HTMLElement).click();
				}
			}
		);
		return;
	}

	plugin.settings.userFields.forEach((field, index) => {
		const nameInput = createCardInput(
			"text",
			"Display Name",
			field.displayName
		);
		const keyInput = createCardInput(
			"text",
			"property-name",
			field.key
		);
		const typeSelect = createCardSelect(
			[
				{
					value: "text",
					label: "Text",
				},
				{
					value: "number",
					label: "Number",
				},
				{
					value: "boolean",
					label: "Boolean",
				},
				{
					value: "date",
					label: "Date",
				},
				{
					value: "list",
					label: "List",
				},
			],
			field.type
		);

		nameInput.addEventListener("change", () => {
			field.displayName = nameInput.value;

			// Update the card header text directly without re-rendering
			const card = container.querySelector(`[data-card-id="${field.id}"]`);
			if (card) {
				const primaryText = card.querySelector(".taskly-settings__card-header-primary");
				if (primaryText) {
					primaryText.textContent = field.displayName ||
						"Unnamed Field";
				}
			}

			save();
		});

		keyInput.addEventListener("change", () => {
			field.key = keyInput.value;

			// Update the card header secondary text directly without re-rendering
			const card = container.querySelector(`[data-card-id="${field.id}"]`);
			if (card) {
				const secondaryText = card.querySelector(".taskly-settings__card-header-secondary");
				if (secondaryText) {
					secondaryText.textContent = field.key ||
						"no-key";
				}
			}

			save();
		});

		typeSelect.addEventListener("change", () => {
			field.type = typeSelect.value as "text" | "number" | "boolean" | "date" | "list";
			// Clear default value when type changes to avoid type mismatches
			field.defaultValue = undefined;
			save();
			// Need to re-render to update the default value input type
			renderUserFieldsList(container, plugin, save, field.id);
		});

		// Default value input based on field type
		const { row: defaultValueRow } = createDefaultValueInput(
			field,
			(value) => {
				field.defaultValue = value;
				save();
			}
		);

		// NLP Trigger for user field
		const nlpRows = createNLPTriggerRows(
			plugin,
			field.id,
			`${field.id}:`,
			save,
			() => renderUserFieldsList(container, plugin, save)
		);

		// Create collapsible filter settings section
		const filterSectionWrapper = document.createElement("div");
		filterSectionWrapper.addClass("taskly-settings__collapsible-section");
		filterSectionWrapper.addClass("taskly-settings__collapsible-section--collapsed");

		// Helper to check if any filters are active
		const hasActiveFilters = (config: typeof field.autosuggestFilter) => {
			if (!config) return false;
			return (
				(config.requiredTags && config.requiredTags.length > 0) ||
				(config.includeFolders && config.includeFolders.length > 0) ||
				(config.propertyKey && config.propertyKey.trim() !== "")
			);
		};

		// Create header for collapsible section
		const filterHeader = filterSectionWrapper.createDiv(
			"taskly-settings__collapsible-section-header"
		);

		const filterHeaderLeft = filterHeader.createDiv(
			"taskly-settings__collapsible-section-header-left"
		);

		const filterHeaderText = filterHeaderLeft.createSpan(
			"taskly-settings__collapsible-section-title"
		);
		filterHeaderText.textContent = "Autosuggestion filters (Advanced)";

		// Add "Filters On" badge if filters are active
		const filterBadge = filterHeaderLeft.createSpan(
			"taskly-settings__filter-badge"
		);
		const updateFilterBadge = () => {
			if (hasActiveFilters(field.autosuggestFilter)) {
				filterBadge.style.display = "inline-flex";
				filterBadge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg><span>Filters On</span>`;
			} else {
				filterBadge.style.display = "none";
			}
		};
		updateFilterBadge();

		const chevron = filterHeader.createSpan("taskly-settings__collapsible-section-chevron");
		chevron.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

		// Create content container
		const filterContent = filterSectionWrapper.createDiv(
			"taskly-settings__collapsible-section-content"
		);

		createFilterSettingsInputs(
			filterContent,
			field.autosuggestFilter,
			(updated) => {
				field.autosuggestFilter = updated;
				updateFilterBadge();
				save();
			}
		);

		// Add click handler to toggle collapse
		filterHeader.addEventListener("click", () => {
			const isCollapsed = filterSectionWrapper.hasClass(
				"taskly-settings__collapsible-section--collapsed"
			);
			if (isCollapsed) {
				filterSectionWrapper.removeClass("taskly-settings__collapsible-section--collapsed");
			} else {
				filterSectionWrapper.addClass("taskly-settings__collapsible-section--collapsed");
			}
		});

		createCard(container, {
			id: field.id,
			collapsible: true,
			defaultCollapsed: field.id !== expandedFieldId,
			header: {
				primaryText:
					field.displayName ||
					"Unnamed Field",
				secondaryText:
					field.key ||
					"no-key",
				meta: [
					createStatusBadge(
						field.type.charAt(0).toUpperCase() + field.type.slice(1),
						"default"
					),
				],
				actions: [
					createDeleteHeaderButton(() => {
						if (plugin.settings.userFields) {
							const fieldId = plugin.settings.userFields[index]?.id;
							plugin.settings.userFields.splice(index, 1);

							save();
							renderUserFieldsList(container, plugin, save);
						}
					}, "Delete field"),
				],
			},
			content: {
				sections: [
					{
						rows: [
							{
								label: "Display Name:",
								input: nameInput,
							},
							{
								label: "Property Key:",
								input: keyInput,
							},
							{
								label: "Type:",
								input: typeSelect,
							},
							defaultValueRow,
							...nlpRows,
						],
					},
					{
						rows: [
							{
								label: "",
								input: filterSectionWrapper,
								fullWidth: true,
							},
						],
					},
				],
			},
		});
	});
}
