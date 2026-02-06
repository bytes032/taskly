import TasklyPlugin from "../../main";
import {
	createSectionHeader,
	createHelpText,
	createSettingGroup,
	configureToggleSetting,
	configureTextSetting,
} from "../components/settingHelpers";

// Import property card modules
import {
	renderTitlePropertyCard,
	renderStatusPropertyCard,
	renderTagsPropertyCard,
	renderRemindersPropertyCard,
	renderUserFieldsSection,
	renderSimplePropertyCard,
	renderMetadataPropertyCard,
} from "./taskProperties";

/**
 * Renders the Task Properties tab - unified property cards
 */
export function renderTaskPropertiesTab(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	container.empty();

	// ===== CORE PROPERTIES SECTION =====
	createSectionHeader(container, "Core Properties");

	// Title Property Card (with filename settings)
	renderTitlePropertyCard(container, plugin, save);

	// Status Property Card
	renderStatusPropertyCard(container, plugin, save);

	// Tags Property Card (special - no property key, uses native Obsidian tags)
	renderTagsPropertyCard(container, plugin, save);

	// ===== DATE PROPERTIES SECTION =====
	createSectionHeader(container, "Date Properties");
	createHelpText(container, "Configure when tasks are due.");

	// Due Date Property Card
	renderSimplePropertyCard(container, plugin, save, {
		propertyId: "due",
		displayName: "Due Date",
		description: "The deadline by which a task must be completed. Tasks past their due date appear as overdue. Stored as a date in frontmatter.",
		hasDefault: true,
		defaultType: "date-preset",
		defaultOptions: [
			{ value: "none", label: "None" },
			{ value: "today", label: "Today" },
			{ value: "tomorrow", label: "Tomorrow" },
			{ value: "next-week", label: "Next week" },
		],
		getDefaultValue: () => plugin.settings.taskCreationDefaults.defaultDueDate,
		setDefaultValue: (value) => {
			plugin.settings.taskCreationDefaults.defaultDueDate = value as "none" | "today" | "tomorrow" | "next-week";
			save();
		},
	});

	// ===== TASK DETAILS SECTION =====
	createSectionHeader(container, "Task Details");
	createHelpText(container, "Additional details like recurrence and reminders.");

	// Recurrence Property Card
	renderSimplePropertyCard(container, plugin, save, {
		propertyId: "recurrence",
		displayName: "Recurrence",
		description: "Pattern for repeating tasks (daily, weekly, monthly, yearly, or custom RRULE). When a recurring task is completed, its due date is automatically updated to the next occurrence.",
		hasDefault: true,
		defaultType: "dropdown",
		defaultOptions: [
			{ value: "none", label: "None" },
			{ value: "daily", label: "Daily" },
			{ value: "weekly", label: "Weekly" },
			{ value: "monthly", label: "Monthly" },
			{ value: "yearly", label: "Yearly" },
		],
		getDefaultValue: () => plugin.settings.taskCreationDefaults.defaultRecurrence,
		setDefaultValue: (value) => {
			plugin.settings.taskCreationDefaults.defaultRecurrence = value as "none" | "daily" | "weekly" | "monthly" | "yearly";
			save();
		},
	});

	// Recurrence Anchor Property Card
	renderMetadataPropertyCard(container, plugin, save, "recurrenceAnchor",
		"Recurrence Anchor",
		"Controls how the next occurrence is calculated: 'due' uses the due date, 'completion' uses the actual completion date.");

	// Reminders Property Card
	renderRemindersPropertyCard(container, plugin, save);

	// ===== BODY TEMPLATE SECTION =====
	createSectionHeader(container, "Body Template");
	createHelpText(container, "Configure a template file to use for new task content.");

	createSettingGroup(
		container,
		{ heading: "" },
		(group) => {
			group.addSetting((setting) =>
				configureToggleSetting(setting, {
					name: "Use body template",
					desc: "Use a template file for task body content",
					getValue: () => plugin.settings.taskCreationDefaults.useBodyTemplate,
					setValue: async (value: boolean) => {
						plugin.settings.taskCreationDefaults.useBodyTemplate = value;
						save();
						renderTaskPropertiesTab(container, plugin, save);
					},
				})
			);

			if (plugin.settings.taskCreationDefaults.useBodyTemplate) {
				group.addSetting((setting) =>
					configureTextSetting(setting, {
						name: "Body template file",
						desc: "Path to template file for task body content. Supports template variables like {{title}}, {{date}}, {{time}}, {{status}}, {{tags}}, etc.",
						placeholder: "Templates/Task Template.md",
						getValue: () => plugin.settings.taskCreationDefaults.bodyTemplate,
						setValue: async (value: string) => {
							plugin.settings.taskCreationDefaults.bodyTemplate = value;
							save();
						},
					})
				);

				group.addSetting((setting) => {
					const variables = [
						"{{title}} - Task title",
						"{{details}} - User-provided details from modal",
						"{{date}} - Current date (YYYY-MM-DD)",
						"{{time}} - Current time (HH:MM)",
						"{{status}} - Task status",
						"{{tags}} - Task tags",
					];
					setting.setName("Template variables:");
					setting.setDesc(variables.join(" • "));
				});
			}
		}
	);

	// ===== METADATA PROPERTIES SECTION =====
	createSectionHeader(container, "Metadata Properties");
	createHelpText(container, "System-managed properties for tracking task history.");

	// Date Created Property Card
	renderMetadataPropertyCard(container, plugin, save, "dateCreated",
		"Date Created",
		"Timestamp when the task was first created. Automatically set and used for sorting by creation order.");

	// Date Modified Property Card
	renderMetadataPropertyCard(container, plugin, save, "dateModified",
		"Date Modified",
		"Timestamp of the last change to the task. Automatically updated when any task property changes.");

	// Completed Date Property Card
	renderMetadataPropertyCard(container, plugin, save, "completedDate",
		"Completed Date",
		"Timestamp when the task was marked complete. Set automatically when status changes to a completed state.");

	// Archive Tag Property Card
	renderMetadataPropertyCard(container, plugin, save, "archiveTag",
		"Archive Tag",
		"Tag added to tasks when archived. Used to identify archived tasks and can trigger file movement to archive folder.");

	// Complete Instances Property Card
	renderMetadataPropertyCard(container, plugin, save, "completeInstances",
		"Complete Instances",
		"Completion history for recurring tasks. Stores dates when each instance was completed to prevent duplicate completions.");

	// Skipped Instances Property Card
	renderMetadataPropertyCard(container, plugin, save, "skippedInstances",
		"Skipped Instances",
		"Skipped occurrences for recurring tasks. Stores dates of instances that were skipped rather than completed.");

	// ===== CUSTOM USER FIELDS SECTION =====
	createSectionHeader(container, "Custom User Fields");
	createHelpText(container, "Define custom frontmatter properties to appear as type-aware filter options across views. Each row: Display Name, Property Name, Type.");

	// Render user fields section (includes list + add button)
	renderUserFieldsSection(container, plugin, save);
}
