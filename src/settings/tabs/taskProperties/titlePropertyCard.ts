import { setIcon } from "obsidian";
import TasklyPlugin from "../../../main";
import {
	createCard,
	createCardInput,
	createCardSelect,
	createCardToggle,
	CardRow,
} from "../../components/CardComponent";
import { createPropertyDescription } from "./helpers";

/**
 * Renders the Title property card with filename settings
 */
export function renderTitlePropertyCard(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	// Create a wrapper for the card so we can re-render it
	const cardWrapper = container.createDiv();
	// Track collapse state across re-renders
	let isCollapsed = true;

	function renderCard(): void {
		cardWrapper.empty();

		const propertyKeyInput = createCardInput(
			"text",
			"title",
			plugin.settings.fieldMapping.title
		);

		propertyKeyInput.addEventListener("change", () => {
			plugin.settings.fieldMapping.title = propertyKeyInput.value;
			save();
		});

		// Store title in filename toggle
		const storeTitleToggle = createCardToggle(
			plugin.settings.storeTitleInFilename,
			(value) => {
				plugin.settings.storeTitleInFilename = value;
				save();
				// Re-render the entire card to show/hide property key
				renderCard();
			}
		);

		// Create nested content for filename settings
		const nestedContainer = document.createElement("div");
		nestedContainer.addClass("taskly-settings__nested-content");
		renderFilenameSettingsContent(nestedContainer, plugin, save);

		// Create description element
		const descriptionEl = createPropertyDescription(
			"The task name. Can be stored in frontmatter or in the filename (when 'Store title in filename' is enabled)."
		);

		const rows: CardRow[] = [
			{ label: "", input: descriptionEl, fullWidth: true },
		];

		// Only show property key when NOT storing title in filename
		if (!plugin.settings.storeTitleInFilename) {
			rows.push({
				label: "Property key:",
				input: propertyKeyInput,
			});
		}

		rows.push(
			{ label: "Store title in filename:", input: storeTitleToggle },
			{ label: "", input: nestedContainer, fullWidth: true }
		);

		createCard(cardWrapper, {
			id: "property-title",
			collapsible: true,
			defaultCollapsed: isCollapsed,
			onCollapseChange: (collapsed) => {
				isCollapsed = collapsed;
			},
			header: {
				primaryText: "Title",
				secondaryText: plugin.settings.storeTitleInFilename
					? "Stored in filename"
					: plugin.settings.fieldMapping.title,
			},
			content: {
				sections: [{ rows }],
			},
		});
	}

	renderCard();
}

/**
 * Renders the filename settings content inside the title card
 */
function renderFilenameSettingsContent(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	container.empty();

	// Only show filename format settings when storeTitleInFilename is off
	if (plugin.settings.storeTitleInFilename) {
		container.createDiv({
			text: "Filename will automatically update when the task title changes.",
			cls: "setting-item-description",
		});
		return;
	}

	// Filename format dropdown
	const formatContainer = container.createDiv("taskly-settings__card-config-row");
	formatContainer.createSpan({
		text: "Filename format:",
		cls: "taskly-settings__card-config-label",
	});

	const formatSelect = createCardSelect(
		[
			{ value: "title", label: "Task title (Non-updating)" },
			{ value: "zettel", label: "Zettelkasten format (YYMMDD + base36 seconds since midnight)" },
			{ value: "timestamp", label: "Full timestamp (YYYY-MM-DD-HHMMSS)" },
			{ value: "custom", label: "Custom template" },
		],
		plugin.settings.taskFilenameFormat
	);
	formatSelect.addEventListener("change", () => {
		plugin.settings.taskFilenameFormat = formatSelect.value as "title" | "zettel" | "timestamp" | "custom";
		save();
		renderFilenameSettingsContent(container, plugin, save);
	});
	formatContainer.appendChild(formatSelect);

	// Custom template input (shown only when format is custom)
	if (plugin.settings.taskFilenameFormat === "custom") {
		const templateContainer = container.createDiv("taskly-settings__card-config-row");
		templateContainer.createSpan({
			text: "Custom template:",
			cls: "taskly-settings__card-config-label",
		});

		const templateInput = createCardInput(
			"text",
			"{date}-{title}-{dueDate}",
			plugin.settings.customFilenameTemplate
		);
		templateInput.style.width = "100%";

		// Warning container for legacy syntax
		const warningContainer = container.createDiv();

		const updateWarning = () => {
			warningContainer.empty();
			// Check for single-brace syntax that isn't part of double-brace
			// Match {word} but not {{word}}
			// Avoid lookbehind for iOS compatibility (iOS < 16.4 doesn't support lookbehind)
			const template = templateInput.value;
			// First check if there are any single braces at all
			const singleBracePattern = /\{[a-zA-Z]+\}/g;
			const doubleBracePattern = /\{\{[a-zA-Z]+\}\}/g;
			// Remove all double-brace patterns, then check for remaining single-brace
			const withoutDoubleBraces = template.replace(doubleBracePattern, "");
			const hasLegacySyntax = singleBracePattern.test(withoutDoubleBraces);

			if (hasLegacySyntax) {
				const warningEl = warningContainer.createDiv({
					cls: "setting-item-description mod-warning",
				});
				warningEl.style.color = "var(--text-warning)";
				warningEl.style.marginTop = "8px";
				warningEl.style.display = "flex";
				warningEl.style.alignItems = "flex-start";
				warningEl.style.gap = "6px";

				const iconEl = warningEl.createSpan();
				setIcon(iconEl, "alert-triangle");
				iconEl.style.flexShrink = "0";

				const textEl = warningEl.createSpan();
				textEl.textContent = "Single-brace syntax like {title} is deprecated. Please use double-brace syntax {{title}} instead for consistency with body templates.";
			}
		};

		templateInput.addEventListener("change", () => {
			plugin.settings.customFilenameTemplate = templateInput.value;
			save();
			updateWarning();
		});
		templateInput.addEventListener("input", updateWarning);
		templateContainer.appendChild(templateInput);

		// Help text for template variables
		container.createDiv({
			text: "Note: {dueDate} is in YYYY-MM-DD format and will be empty if not set.",
			cls: "setting-item-description",
		});

		// Initial warning check
		updateWarning();
	}
}
