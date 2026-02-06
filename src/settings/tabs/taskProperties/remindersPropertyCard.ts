import TasklyPlugin from "../../../main";
import { DefaultReminder } from "../../../types/settings";
import {
	createCard,
	createCardInput,
	createDeleteHeaderButton,
	showCardEmptyState,
	createCardNumberInput,
	createCardSelect,
	CardRow,
} from "../../components/CardComponent";
import { createPropertyDescription } from "./helpers";

/**
 * Renders the Reminders property card with nested default reminders
 */
export function renderRemindersPropertyCard(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	const propertyKeyInput = createCardInput(
		"text",
		"reminders",
		plugin.settings.fieldMapping.reminders
	);

	propertyKeyInput.addEventListener("change", () => {
		plugin.settings.fieldMapping.reminders = propertyKeyInput.value;
		save();
	});

	// Create nested content for default reminders
	const nestedContainer = document.createElement("div");
	nestedContainer.addClass("taskly-settings__nested-cards");

	// Create collapsible section for default reminders
	const remindersSection = nestedContainer.createDiv("taskly-settings__collapsible-section");

	const remindersHeader = remindersSection.createDiv("taskly-settings__collapsible-section-header");
	remindersHeader.createSpan({ text: "Default Reminders", cls: "taskly-settings__collapsible-section-title" });
	const chevron = remindersHeader.createSpan("taskly-settings__collapsible-section-chevron");
	chevron.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

	const remindersContent = remindersSection.createDiv("taskly-settings__collapsible-section-content");

	// Render reminder cards
	const remindersListContainer = remindersContent.createDiv("taskly-reminders-container");
	renderRemindersList(remindersListContainer, plugin, save);

	// Add reminder button
	const addReminderButton = remindersContent.createEl("button", {
		text: "Add reminder",
		cls: "tn-btn tn-btn--ghost",
	});
	addReminderButton.style.marginTop = "0.5rem";
	addReminderButton.onclick = () => {
		const newId = `reminder_${Date.now()}`;
		const newReminder = {
			id: newId,
			type: "relative" as const,
			relatedTo: "due" as const,
			offset: 1,
			unit: "hours" as const,
			direction: "before" as const,
			description: "Reminder",
		};
		plugin.settings.taskCreationDefaults.defaultReminders =
			plugin.settings.taskCreationDefaults.defaultReminders || [];
		plugin.settings.taskCreationDefaults.defaultReminders.push(newReminder);
		save();
		renderRemindersList(remindersListContainer, plugin, save);
	};

	// Toggle collapse
	remindersHeader.addEventListener("click", () => {
		remindersSection.toggleClass("taskly-settings__collapsible-section--collapsed",
			!remindersSection.hasClass("taskly-settings__collapsible-section--collapsed"));
	});

	// Create description element
	const descriptionEl = createPropertyDescription(
		"Notifications triggered before due dates. Stored as a list of reminder objects with timing and optional description."
	);

	const rows: CardRow[] = [
		{ label: "", input: descriptionEl, fullWidth: true },
		{ label: "Property key:", input: propertyKeyInput },
		{ label: "", input: nestedContainer, fullWidth: true },
	];

	createCard(container, {
		id: "property-reminders",
		collapsible: true,
		defaultCollapsed: true,
		header: {
			primaryText: "Reminders",
			secondaryText: plugin.settings.fieldMapping.reminders,
		},
		content: {
			sections: [{ rows }],
		},
	});
}

/**
 * Renders the list of default reminder cards
 */
function renderRemindersList(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	container.empty();

	if (
		!plugin.settings.taskCreationDefaults.defaultReminders ||
		plugin.settings.taskCreationDefaults.defaultReminders.length === 0
	) {
		showCardEmptyState(
			container,
			"No default reminders configured. Add a reminder to automatically notify you about new tasks."
		);
		return;
	}

	plugin.settings.taskCreationDefaults.defaultReminders.forEach((reminder, index) => {
		const timingText = formatReminderTiming(reminder);

		const descInput = createCardInput(
			"text",
			"Reminder description",
			reminder.description
		);

		const typeSelect = createCardSelect(
			[
				{
					value: "relative",
					label: "Relative (before/after task dates)",
				},
				{
					value: "absolute",
					label: "Absolute (specific date/time)",
				},
			],
			reminder.type
		);

		const updateCallback = (updates: Partial<DefaultReminder>) => {
			Object.assign(reminder, updates);
			save();
			const card = container.querySelector(`[data-card-id="${reminder.id}"]`);
			if (card) {
				const secondaryText = card.querySelector(
					".taskly-settings__card-secondary-text"
				);
				if (secondaryText) {
					secondaryText.textContent = formatReminderTiming(reminder);
				}
			}
		};

		const configRows =
			reminder.type === "relative"
				? renderRelativeReminderConfig(reminder, updateCallback)
				: renderAbsoluteReminderConfig(reminder, updateCallback);

		const card = createCard(container, {
			id: reminder.id,
			collapsible: true,
			defaultCollapsed: true,
			header: {
				primaryText:
					reminder.description ||
					"Unnamed Reminder",
				secondaryText: timingText,
				actions: [
					createDeleteHeaderButton(() => {
						plugin.settings.taskCreationDefaults.defaultReminders.splice(index, 1);
						save();
						renderRemindersList(container, plugin, save);
					}, "Delete reminder"),
				],
			},
			content: {
				sections: [
					{
						rows: [
							{
								label: "Description:",
								input: descInput,
							},
							{
								label: "Type:",
								input: typeSelect,
							},
						],
					},
					{
						rows: configRows,
					},
				],
			},
		});

		descInput.addEventListener("input", () => {
			reminder.description = descInput.value;
			save();
			const primaryText = card.querySelector(".taskly-settings__card-primary-text");
			if (primaryText) {
				primaryText.textContent =
					reminder.description ||
					"Unnamed Reminder";
			}
		});

		typeSelect.addEventListener("change", () => {
			reminder.type = typeSelect.value as "relative" | "absolute";
			save();
			renderRemindersList(container, plugin, save);
		});
	});
}

function renderRelativeReminderConfig(
	reminder: DefaultReminder,
	updateItem: (updates: Partial<DefaultReminder>) => void
): CardRow[] {
	const offsetInput = createCardNumberInput(0, undefined, 1, reminder.offset);
	offsetInput.addEventListener("input", () => {
		const offset = parseInt(offsetInput.value);
		if (!isNaN(offset) && offset >= 0) {
			updateItem({ offset });
		}
	});

	const unitSelect = createCardSelect(
		[
			{ value: "minutes", label: "minutes" },
			{ value: "hours", label: "hours" },
			{ value: "days", label: "days" },
		],
		reminder.unit
	);
	unitSelect.addEventListener("change", () => {
		updateItem({ unit: unitSelect.value as "minutes" | "hours" | "days" });
	});

	const directionSelect = createCardSelect(
		[
			{ value: "before", label: "before" },
			{ value: "after", label: "after" },
		],
		reminder.direction
	);
	directionSelect.addEventListener("change", () => {
		updateItem({ direction: directionSelect.value as "before" | "after" });
	});

	const relatedToSelect = createCardSelect(
		[
			{ value: "due", label: "due date" },
		],
		reminder.relatedTo
	);
	relatedToSelect.addEventListener("change", () => {
		updateItem({ relatedTo: relatedToSelect.value as "due" });
	});

	return [
		{ label: "Offset:", input: offsetInput },
		{ label: "Unit:", input: unitSelect },
		{
			label: "Direction:",
			input: directionSelect,
		},
		{
			label: "Related to:",
			input: relatedToSelect,
		},
	];
}

function renderAbsoluteReminderConfig(
	reminder: DefaultReminder,
	updateItem: (updates: Partial<DefaultReminder>) => void
): CardRow[] {
	const dateInput = createCardInput(
		"date",
		reminder.absoluteDate || new Date().toISOString().split("T")[0]
	);
	dateInput.addEventListener("input", () => {
		updateItem({ absoluteDate: dateInput.value });
	});

	const timeInput = createCardInput("time", reminder.absoluteTime || "09:00");
	timeInput.addEventListener("input", () => {
		updateItem({ absoluteTime: timeInput.value });
	});

	return [
		{ label: "Date:", input: dateInput },
		{ label: "Time:", input: timeInput },
	];
}

function formatReminderTiming(
	reminder: DefaultReminder
): string {
	if (reminder.type === "relative") {
		const direction =
			reminder.direction === "before"
				? "before"
				: "after";
		const unit = reminder.unit || "hours";
		const offset = reminder.offset ?? 1;
		const relatedTo = "due date";
		return `${offset} ${unit} ${direction} ${relatedTo}`;
	} else {
		const date = reminder.absoluteDate || "Date:";
		const time = reminder.absoluteTime || "Time:";
		return `${date} at ${time}`;
	}
}
