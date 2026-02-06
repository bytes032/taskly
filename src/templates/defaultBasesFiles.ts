/**
 * Default .base file templates for Taskly views.
 * These are created in _taskly/views/ directory when the user first uses the commands.
 */

import type { TasklySettings } from "../types/settings";
import type TasklyPlugin from "../main";
import type { FieldMapping } from "../types";

/**
 * Generate a task filter expression based on the task identification method
 * Returns the filter condition string (not the full YAML structure)
 */
function generateTaskFilterCondition(settings: TasklySettings): string {
	if (settings.taskIdentificationMethod === "tag") {
		// Filter by tag using hasTag method
		const taskTag = settings.taskTag || "task";
		return `file.hasTag("${taskTag}")`;
	} else {
		// Filter by property
		const propertyName = settings.taskPropertyName;
		const propertyValue = settings.taskPropertyValue;

		if (!propertyName) {
			// No property name specified, fall back to tag-based filtering
			const taskTag = settings.taskTag || "task";
			return `file.hasTag("${taskTag}")`;
		}

		if (propertyValue) {
			// Check property has specific value
			return `note.${propertyName} == "${propertyValue}"`;
		} else {
			// Just check property exists (is not empty)
			return `note.${propertyName} && note.${propertyName} != "" && note.${propertyName} != null`;
		}
	}
}

/**
 * Format filter condition(s) as YAML object notation
 */
function formatFilterAsYAML(conditions: string | string[]): string {
	const conditionArray = Array.isArray(conditions) ? conditions : [conditions];
	const formattedConditions = conditionArray.map(c => `    - ${c}`).join('\n');
	return `filters:
  and:
${formattedConditions}`;
}

/**
 * Extract just the property name from a fully-qualified property path
 * e.g., "note.tags" -> "tags", "file.ctime" -> "ctime"
 */
function getPropertyName(fullPath: string): string {
	return fullPath.replace(/^(note\.|file\.|task\.|formula\.)/, '');
}

function escapeFormulaString(value: string): string {
	return value.replace(/"/g, '\\"');
}

/**
 * Map internal Taskly property names to Bases property names.
 * Uses FieldMapper for type-safe field mapping.
 */
function mapPropertyToBasesProperty(property: string, plugin: TasklyPlugin): string {
	const fm = plugin.fieldMapper;

	// Handle user-defined fields (format: "user:field_xxx")
	if (property.startsWith("user:")) {
		const fieldId = property.substring(5); // Remove "user:" prefix
		const userField = plugin.settings.userFields?.find(f => f.id === fieldId);
		if (userField) {
			return userField.key;
		}
		// If field not found, return the ID as-is (shouldn't happen in normal use)
		return property;
	}

	// Handle special Bases-specific properties first
	switch (property) {
		case "tags":
			return "file.tags";
		case "dateCreated":
			return "file.ctime";
		case "dateModified":
			return "file.mtime";
		case "title":
			return "file.name";
		case "complete_instances":
			return fm.toUserField("completeInstances");
	}

	// Try to map using FieldMapper
	const mapping = fm.getMapping();
	if (property in mapping) {
		return fm.toUserField(property as keyof FieldMapping);
	}

	// Unknown property, return as-is
	return property;
}

/**
 * Generate the order array from defaultVisibleProperties
 */
function generateOrderArray(plugin: TasklyPlugin): string[] {
	const settings = plugin.settings;
	const visibleProperties = settings.defaultVisibleProperties || [
		"status",
		"due",
		"tags",
	];

	// Map to Bases property names, filtering out null/empty values
	const basesProperties = visibleProperties
		.map(prop => mapPropertyToBasesProperty(prop, plugin))
		.filter((prop): prop is string => !!prop);

	// Add essential properties that should always be in the order
	const essentialProperties = [
		"file.name", // title
		mapPropertyToBasesProperty("recurrence", plugin),
		mapPropertyToBasesProperty("complete_instances", plugin),
	].filter((prop): prop is string => !!prop);

	// Combine, removing duplicates while preserving order
	const allProperties: string[] = [];
	const seen = new Set<string>();

	// Add visible properties first
	for (const prop of basesProperties) {
		if (prop && !seen.has(prop)) {
			allProperties.push(prop);
			seen.add(prop);
		}
	}

	// Add essential properties
	for (const prop of essentialProperties) {
		if (prop && !seen.has(prop)) {
			allProperties.push(prop);
			seen.add(prop);
		}
	}

	return allProperties;
}

/**
 * Format the order array as YAML
 */
function formatOrderArray(orderArray: string[]): string {
	return orderArray.map(prop => `      - ${prop}`).join('\n');
}

/**
 * Generate all useful formulas for Taskly views.
 * These formulas provide calculated values that can be used in views, filters, and sorting.
 */
function generateAllFormulas(plugin: TasklyPlugin): Record<string, string> {
	const dueProperty = getPropertyName(mapPropertyToBasesProperty('due', plugin));
	const statusProperty = getPropertyName(mapPropertyToBasesProperty('status', plugin));

	// Boolean done field: true → 1 (completed), false → 0 (open)
	const statusOrderFormula = `if(${statusProperty}, 1, 0)`;

	// Boolean done field: not completed = !done
	const completedStatusCheck = `!${statusProperty}`;

	const recurrenceProperty = getPropertyName(mapPropertyToBasesProperty('recurrence', plugin));

	return {
		// Days until due (negative = overdue, positive = days remaining)
		// Convert dates to ms (via number()) before subtracting to get numeric difference
		daysUntilDue: `if(${dueProperty}, ((number(date(${dueProperty})) - number(today())) / 86400000).floor(), null)`,

		// Days since the task was created
		daysSinceCreated: '((number(now()) - number(file.ctime)) / 86400000).floor()',

		// Days since the task was last modified
		daysSinceModified: '((number(now()) - number(file.mtime)) / 86400000).floor()',

		// === BOOLEAN FORMULAS ===

		// Boolean: is this task overdue?
		isOverdue: `${dueProperty} && date(${dueProperty}) < today() && ${completedStatusCheck}`,

		// Numeric: status order for sorting (lower = higher priority)
		statusOrder: statusOrderFormula,

		// Boolean: is this task due today?
		isDueToday: `${dueProperty} && date(${dueProperty}).date() == today()`,

		// Boolean: is this task due within the next 7 days?
		isDueThisWeek: `${dueProperty} && date(${dueProperty}) >= today() && date(${dueProperty}) <= today() + "7d"`,

		// Boolean: is this a recurring task?
		isRecurring: `${recurrenceProperty} && !${recurrenceProperty}.isEmpty()`,

		// === GROUPING FORMULAS ===

		// Due date formatted as "YYYY-MM" for grouping by month
		dueMonth: `if(${dueProperty}, date(${dueProperty}).format("YYYY-MM"), "No due date")`,

		// Due date formatted as "YYYY-[W]WW" for grouping by week
		dueWeek: `if(${dueProperty}, date(${dueProperty}).format("YYYY-[W]WW"), "No due date")`,

		// Due date category for grouping: Overdue, Today, Tomorrow, This Week, Later, No Due Date
		dueDateCategory: `if(!${dueProperty}, "No due date", if(date(${dueProperty}) < today(), "Overdue", if(date(${dueProperty}).date() == today(), "Today", if(date(${dueProperty}).date() == today() + "1d", "Tomorrow", if(date(${dueProperty}) <= today() + "7d", "This week", "Later")))))`,

		// Age category based on creation date
		ageCategory: 'if(((number(now()) - number(file.ctime)) / 86400000) < 1, "Today", if(((number(now()) - number(file.ctime)) / 86400000) < 7, "This week", if(((number(now()) - number(file.ctime)) / 86400000) < 30, "This month", "Older")))',

		// Created month for grouping
		createdMonth: 'file.ctime.format("YYYY-MM")',

		// Modified month for grouping
		modifiedMonth: 'file.mtime.format("YYYY-MM")',

		// === DUE-ONLY FORMULAS ===

		// Next date (same as due date now that scheduling is removed)
		nextDate: `if(${dueProperty}, ${dueProperty}, null)`,

		// Days until next date (same as daysUntilDue)
		daysUntilNext: `if(${dueProperty}, formula.daysUntilDue, null)`,

		// Boolean: has any date
		hasDate: `${dueProperty}`,

		// Boolean: is due today
		isToday: `(${dueProperty} && date(${dueProperty}).date() == today())`,

		// Boolean: is due this week
		isThisWeek: `(${dueProperty} && date(${dueProperty}) >= today() && date(${dueProperty}) <= today() + "7d")`,

		// Next date category for grouping (same as dueDateCategory)
		nextDateCategory: `if(!${dueProperty}, "No date", if(date(${dueProperty}) < today(), "Overdue", if(date(${dueProperty}).date() == today(), "Today", if(date(${dueProperty}).date() == today() + "1d", "Tomorrow", if(date(${dueProperty}) <= today() + "7d", "This week", "Later")))))`,

		// Next date as month for grouping
		nextDateMonth: `if(${dueProperty}, date(${dueProperty}).format("YYYY-MM"), "No date")`,

		// Next date as week for grouping
		nextDateWeek: `if(${dueProperty}, date(${dueProperty}).format("YYYY-[W]WW"), "No date")`,

		// === DISPLAY FORMULAS ===

		// Due date as human-readable relative text
		dueDateDisplay: `if(!${dueProperty}, "", if(date(${dueProperty}).date() == today(), "Today", if(date(${dueProperty}).date() == today() + "1d", "Tomorrow", if(date(${dueProperty}).date() == today() - "1d", "Yesterday", if(date(${dueProperty}) < today(), formula.daysUntilDue * -1 + "d ago", if(date(${dueProperty}) <= today() + "7d", date(${dueProperty}).format("ddd"), date(${dueProperty}).format("MMM D")))))))`,
	};
}

/**
 * Generate the formulas section YAML including all useful formulas
 */
function generateFormulasSection(plugin: TasklyPlugin): string {
	const formulas = generateAllFormulas(plugin);

	const formulaLines = Object.entries(formulas)
		.map(([name, formula]) => `  ${name}: '${formula}'`)
		.join('\n');

	return `formulas:\n${formulaLines}`;
}

/**
 * Generate a Bases file template for a specific command with user settings
 */
export function generateBasesFileTemplate(commandId: string, plugin: TasklyPlugin): string {
	const settings = plugin.settings;
	const taskFilterCondition = generateTaskFilterCondition(settings);
	const orderArray = generateOrderArray(plugin);
	const orderYaml = formatOrderArray(orderArray);
	const formulasSection = generateFormulasSection(plugin);
	const archiveTag = plugin.fieldMapper.getMapping().archiveTag || "archived";
	const escapedArchiveTag = escapeFormulaString(archiveTag);
	const archivedRule = `!(file.tags.containsAny("${escapedArchiveTag}") && ((completedDate && date(completedDate) <= today() - "1d") || (!completedDate && date(dateModified) <= today() - "1d")))`;

	switch (commandId) {
		case 'open-table-view': {
			return `# Task Table
${formatFilterAsYAML([taskFilterCondition])}

${formulasSection}

views:
  - type: tasklyTable
    name: "Task Table"
    filters:
      and:
        - '!file.tags.containsAny("someday")'
        - '${archivedRule}'
    order:
${orderYaml}
    sort:
      - property: formula.statusOrder
        direction: ASC
      - property: dateCreated
        direction: DESC
    options:
      showTableHeader: true
`;
		}
		default:
			return '';
	}
}
