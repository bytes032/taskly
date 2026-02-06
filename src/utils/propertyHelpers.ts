import type TasklyPlugin from "../main";
import type { FieldMapping } from "../types";

/**
 * Get all available properties for property selection modals.
 * Returns internal property IDs (FieldMapping keys) with labels showing
 * both the display name and user-configured property name.
 *
 * Includes both core properties and user-defined fields.
 */
export function getAvailableProperties(
	plugin: TasklyPlugin
): Array<{ id: string; label: string }> {
	// Helper to create label showing user's configured property name
	const makeLabel = (displayName: string, mappingKey: keyof FieldMapping): string => {
		const userPropertyName = plugin.fieldMapper.toUserField(mappingKey);
		// Only show the property name if it differs from the display name (lowercased)
		if (userPropertyName !== displayName.toLowerCase().replace(/\s+/g, "")) {
			return `${displayName} (${userPropertyName})`;
		}
		return displayName;
	};

	// Core properties using FieldMapping keys as IDs
	const coreProperties = [
		{ id: "status", label: makeLabel("Status", "status") },
		{ id: "due", label: makeLabel("Due Date", "due") },
		{ id: "recurrence", label: makeLabel("Recurrence", "recurrence") },
		{ id: "completeInstances", label: makeLabel("Completed Instances", "completeInstances") },
		{ id: "skippedInstances", label: makeLabel("Skipped Instances", "skippedInstances") },
		{ id: "completedDate", label: makeLabel("Completed Date", "completedDate") },
		{ id: "dateCreated", label: makeLabel("Created Date", "dateCreated") },
		{ id: "dateModified", label: makeLabel("Modified Date", "dateModified") },
		{ id: "tags", label: "Tags" }, // Special property, not in FieldMapping
	];

	// Add user-defined fields
	const userProperties =
		plugin.settings.userFields?.map((field) => ({
			id: `user:${field.id}`,
			label: field.displayName,
		})) || [];

	return [...coreProperties, ...userProperties];
}

/**
 * Get labels for a list of property IDs
 * Useful for displaying current selection
 */
export function getPropertyLabels(
	plugin: TasklyPlugin,
	propertyIds: string[]
): string[] {
	const availableProperties = getAvailableProperties(plugin);
	return propertyIds
		.map((id) => availableProperties.find((p) => p.id === id)?.label || id)
		.filter(Boolean);
}
