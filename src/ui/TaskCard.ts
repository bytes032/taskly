/* eslint-disable no-console */
import { TFile, setIcon, Notice, Modal, App, setTooltip, Menu } from "obsidian";
import { TaskInfo } from "../types";
import TasklyPlugin from "../main";
import { TaskContextMenu } from "../components/TaskContextMenu";
import {
	getEffectiveTaskStatus,
	getRecurrenceDisplayText,
} from "../utils/helpers";
import { FilterUtils } from "../utils/FilterUtils";
import {
	formatDateTimeForDisplay,
	isTodayTimeAware,
	isOverdueTimeAware,
	getDatePart,
	getTimePart,
	formatDateForStorage,
} from "../utils/dateUtils";
import { DateContextMenu } from "../components/DateContextMenu";
import { RecurrenceContextMenu } from "../components/RecurrenceContextMenu";
import { createTaskClickHandler, createTaskHoverHandler } from "../utils/clickHandlers";
import { ReminderModal } from "../modals/ReminderModal";
import {
	renderTextWithLinks,
	type LinkServices,
} from "./renderers/linkRenderer";
import { renderTagsValue } from "./renderers/tagRenderer";
import {
	convertInternalToUserProperties,
	isPropertyForField,
} from "../utils/propertyMapping";
import { DEFAULT_INTERNAL_VISIBLE_PROPERTIES } from "../settings/defaults";
import { formatString } from "../utils/stringFormat";

export interface TaskCardOptions {
	targetDate?: Date;
	layout?: "default" | "compact" | "inline" | "table";
	/** When true, hide status indicator (e.g., when Kanban is grouped by status) */
	hideStatusIndicator?: boolean;
}

export const DEFAULT_TASK_CARD_OPTIONS: TaskCardOptions = {
	layout: "default",
};

/* =================================================================
   BADGE INDICATOR HELPERS
   ================================================================= */

interface BadgeIndicatorConfig {
	container: HTMLElement;
	className: string;
	icon: string;
	tooltip: string;
	ariaLabel?: string;
	onClick?: (e: MouseEvent) => void;
	visible?: boolean;
}

/**
 * Creates a badge indicator element with icon, tooltip, and optional click handler.
 * Returns the element, or null if visible is false.
 */
function createBadgeIndicator(config: BadgeIndicatorConfig): HTMLElement | null {
	const { container, className, icon, tooltip, ariaLabel, onClick, visible = true } = config;

	if (!visible) return null;

	const indicator = container.createEl("div", {
		cls: className,
		attr: { "aria-label": ariaLabel || tooltip },
	});

	setIcon(indicator, icon);
	setTooltip(indicator, tooltip, { placement: "top" });

	if (onClick) {
		indicator.addEventListener("click", (e) => {
			e.stopPropagation();
			onClick(e);
		});
	}

	return indicator;
}

/**
 * Updates or creates a badge indicator, returning the element.
 * If the indicator should not exist, removes any existing one and returns null.
 */
function updateBadgeIndicator(
	container: HTMLElement,
	selector: string,
	config: Omit<BadgeIndicatorConfig, "container"> & { shouldExist: boolean }
): HTMLElement | null {
	const existing = container.querySelector(selector) as HTMLElement | null;

	if (!config.shouldExist) {
		existing?.remove();
		return null;
	}

	if (existing) {
		// Update existing indicator
		existing.setAttribute("aria-label", config.ariaLabel || config.tooltip);
		setTooltip(existing, config.tooltip, { placement: "top" });
		return existing;
	}

	// Create new indicator
	const badgesContainer = container.querySelector(".task-card__badges") as HTMLElement;
	const targetContainer = badgesContainer || container.querySelector(".task-card__main-row") as HTMLElement;

	if (!targetContainer) return null;

	return createBadgeIndicator({
		container: targetContainer,
		...config,
	});
}

/* =================================================================
   CLICK HANDLER FACTORIES
   ================================================================= */

/**
 * Creates a click handler for marking task done
 */
function createStatusCycleHandler(
	task: TaskInfo,
	plugin: TasklyPlugin,
	card: HTMLElement,
	statusDot: HTMLElement,
	targetDate: Date
): (e: MouseEvent) => Promise<void> {
	return async (e: MouseEvent) => {
		e.stopPropagation();
		try {
			const completedStatus = plugin.statusManager.getCompletedStatuses()[0] || "done";

			if (task.recurrence) {
				// For recurring tasks, only mark as complete (no toggle)
				const dateStr = formatDateForStorage(targetDate);
				if (task.complete_instances?.includes(dateStr)) {
					return;
				}

				// Mark completion for the target date
				const updatedTask = await plugin.toggleRecurringTaskComplete(task, targetDate);
				const newEffectiveStatus = getEffectiveTaskStatus(updatedTask, targetDate);
				const newStatusConfig = plugin.statusManager.getStatusConfig(newEffectiveStatus);
				const isNowCompleted = plugin.statusManager.isCompletedStatus(newEffectiveStatus);

				if (newStatusConfig) {
					statusDot.style.borderColor = newStatusConfig.color;
					// Update icon if configured
					if (newStatusConfig.icon) {
						statusDot.addClass("task-card__status-dot--icon");
						statusDot.empty();
						setIcon(statusDot, newStatusConfig.icon);
					} else {
						statusDot.removeClass("task-card__status-dot--icon");
						statusDot.empty();
					}
				}

				// Update card classes
				updateCardCompletionState(card, task, plugin, isNowCompleted, newEffectiveStatus);
				return;
			}

			// Regular task: mark as done if not already completed
			const freshTask = await plugin.cacheManager.getTaskInfo(task.path);
			if (!freshTask) {
				new Notice("Task not found");
				return;
			}
			const currentStatus = freshTask.status || "open";
			if (plugin.statusManager.isCompletedStatus(currentStatus)) {
				return;
			}
			await plugin.updateTaskProperty(freshTask, "status", completedStatus);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Error marking task done:", { error: errorMessage, taskPath: task.path });
			new Notice(`Failed to update task status: ${errorMessage}`);
		}
	};
}

/**
 * Updates card classes based on completion state
 */
function updateCardCompletionState(
	card: HTMLElement,
	task: TaskInfo,
	plugin: TasklyPlugin,
	isCompleted: boolean,
	effectiveStatus: string
): void {
	const cardClasses = ["task-card"];
	if (isCompleted) cardClasses.push("task-card--completed");
	if (task.archived) cardClasses.push("task-card--archived");
	if (task.recurrence) cardClasses.push("task-card--recurring");
	if (effectiveStatus) cardClasses.push(`task-card--status-${effectiveStatus}`);

	card.className = cardClasses.join(" ");
	card.dataset.status = effectiveStatus;

	// Update title styling
	const titleEl = card.querySelector(".task-card__title") as HTMLElement;
	const titleTextEl = card.querySelector(".task-card__title-text") as HTMLElement;
	if (titleEl) titleEl.classList.toggle("completed", isCompleted);
	if (titleTextEl) titleTextEl.classList.toggle("completed", isCompleted);
}

/**
 * Creates a click handler for recurrence indicator
 */
function createRecurrenceClickHandler(
	task: TaskInfo,
	plugin: TasklyPlugin
): (e: MouseEvent) => void {
	return (e: MouseEvent) => {
		e.stopPropagation();
		const menu = new RecurrenceContextMenu({
			currentValue: typeof task.recurrence === "string" ? task.recurrence : undefined,
			currentAnchor: task.recurrence_anchor || "due",
			onSelect: async (newRecurrence, anchor) => {
				try {
					await plugin.updateTaskProperty(task, "recurrence", newRecurrence || undefined);
					if (anchor !== undefined) {
						await plugin.updateTaskProperty(task, "recurrence_anchor", anchor);
					}
				} catch (error) {
					console.error("Error updating recurrence:", error);
					new Notice("Failed to update recurrence");
				}
			},
			app: plugin.app,
			plugin: plugin,
		});
		menu.show(e);
	};
}

/**
 * Creates a click handler for reminder indicator
 */
function createReminderClickHandler(
	task: TaskInfo,
	plugin: TasklyPlugin
): () => void {
	return () => {
		const modal = new ReminderModal(plugin.app, plugin, task, async (reminders) => {
			try {
				await plugin.updateTaskProperty(task, "reminders", reminders.length > 0 ? reminders : undefined);
			} catch (error) {
				console.error("Error updating reminders:", error);
				new Notice("Failed to update reminders");
			}
		});
		modal.open();
	};
}

/**
 * Helper function to attach date context menu click handlers
 */
function attachDateClickHandler(
	span: HTMLElement,
	task: TaskInfo,
	plugin: TasklyPlugin,
	dateType: "due"
): void {
	span.addEventListener("click", (e) => {
		e.stopPropagation(); // Don't trigger card click
		const currentValue = task.due;
		const menu = new DateContextMenu({
			currentValue: getDatePart(currentValue || ""),
			currentTime: getTimePart(currentValue || ""),
			onSelect: async (dateValue, timeValue) => {
				try {
					let finalValue: string | undefined;
					if (!dateValue) {
						finalValue = undefined;
					} else if (timeValue) {
						finalValue = `${dateValue}T${timeValue}`;
					} else {
						finalValue = dateValue;
					}
					await plugin.updateTaskProperty(task, "due", finalValue);
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					console.error("Error updating due date:", errorMessage);
					new Notice(
						formatString("Failed to update task due date: {message}", {
							message: errorMessage,
						})
					);
				}
			},
			plugin,
			app: plugin.app,
		});
		menu.show(e as MouseEvent);
	});
}

/**
 * Get default visible properties when no custom configuration is provided.
 * Returns user-configured property names (e.g., "task-status" if user customized the status field).
 *
 * @param plugin - The plugin instance with fieldMapper
 * @returns Array of user-configured property names
 */
function getDefaultVisibleProperties(plugin: TasklyPlugin): string[] {
	// Combine FieldMapping properties with special properties
	const internalDefaults = [
		...DEFAULT_INTERNAL_VISIBLE_PROPERTIES,
		"tags", // Special property (not in FieldMapping)
	];

	return convertInternalToUserProperties(internalDefaults, plugin);
}

/**
 * Property value extractors for better type safety and error handling
 */
const PROPERTY_EXTRACTORS: Record<string, (task: TaskInfo) => any> = {
	due: (task) => task.due,
	tags: (task) => task.tags,
	recurrence: (task) => task.recurrence,
	completedDate: (task) => task.completedDate,
	reminders: (task) => task.reminders,
	completeInstances: (task) => task.complete_instances,
	skippedInstances: (task) => task.skipped_instances,
	dateCreated: (task) => task.dateCreated,
	dateModified: (task) => task.dateModified,
};

/**
 * Extract raw value from a Bases Value object.
 * Bases API may return objects like {icon: "...", data: ...} or {icon: "...", link: "..."}
 * instead of raw primitive values. This function extracts the actual value.
 *
 * For link values (icon: "lucide-link"), Bases strips the [[]] from wikilinks,
 * so we need to restore them to ensure proper rendering.
 */
function extractBasesValue(value: unknown): unknown {
	if (value && typeof value === "object" && "icon" in value) {
		const v = value as Record<string, unknown>;

		// Handle link results (icon: "lucide-link") - restore wikilink format for internal links
		// Bases stores the link path in "data" field for links
		if (v.icon === "lucide-link" && "data" in v && v.data !== null && v.data !== undefined) {
			const linkPath = String(v.data);
			// Check if it's an internal link (not a URL) - restore wikilink format
			if (!linkPath.match(/^[a-z]+:\/\//i)) {
				// Get display text if available
				const display = "display" in v && v.display ? String(v.display) : null;
				if (display && display !== linkPath) {
					return `[[${linkPath}|${display}]]`;
				}
				return `[[${linkPath}]]`;
			}
			// External URL - return as markdown link if we have display text
			const display = "display" in v && v.display ? String(v.display) : null;
			if (display) {
				return `[${display}](${linkPath})`;
			}
			return linkPath;
		}

		// Return data value if present (for non-link types)
		if ("data" in v && v.data !== null && v.data !== undefined) {
			return v.data;
		}
		// Handle date results
		if (v.icon === "lucide-calendar" && "date" in v) {
			return v.date;
		}
		// Handle text results with display property
		if ("display" in v && v.display !== null && v.display !== undefined) {
			return v.display;
		}
		// Handle missing/empty data indicators
		if (v.icon === "lucide-file-question" || v.icon === "lucide-help-circle") {
			return "";
		}
		// Fallback for other icon-only results
		return v.icon ? String(v.icon).replace("lucide-", "") : "";
	}
	return value;
}

/**
 * Get property value from a task with improved error handling and type safety.
 *
 * @param task - The task to extract the property from
 * @param propertyId - The property identifier (user-configured or internal name)
 * @param plugin - Taskly plugin instance
 * @returns The property value, or undefined if not found
 */
function getPropertyValue(task: TaskInfo, propertyId: string, plugin: TasklyPlugin): unknown {
	try {
		// Check if this is a user-configured name for a mapped field
		const mappingKey = plugin.fieldMapper.lookupMappingKey(propertyId);
		if (mappingKey) {
			// Use the mapping key as the extractor key (e.g., "due")
			if (mappingKey in PROPERTY_EXTRACTORS) {
				return PROPERTY_EXTRACTORS[mappingKey](task);
			}
		}

		// Try direct property lookup (for non-mapped properties)
		if (propertyId in PROPERTY_EXTRACTORS) {
			return PROPERTY_EXTRACTORS[propertyId](task);
		}

		// Handle user properties
		if (propertyId.startsWith("user:")) {
			return getUserPropertyValue(task, propertyId, plugin);
		}

		// Check custom properties from Bases or other sources
		// Values may be Bases Value objects, so extract the raw value
		if (task.customProperties && propertyId in task.customProperties) {
			return extractBasesValue(task.customProperties[propertyId]);
		}

		// Check for file properties (stored as "file.name", "file.basename", etc.)
		if (task.customProperties) {
			const filePropertyId = `file.${propertyId}`;
			if (filePropertyId in task.customProperties) {
				return extractBasesValue(task.customProperties[filePropertyId]);
			}
		}

		// Lazy fetch for file.* properties (backlinks, links, embeds, etc.)
		// These are NOT pre-extracted for performance - only computed when visible
		if (propertyId.startsWith("file.") && task.basesData && typeof task.basesData.getValue === "function") {
			try {
				const value = task.basesData.getValue(propertyId as any);
				if (value !== null && value !== undefined) {
					return extractBasesValue(value);
				}
			} catch (error) {
				// Property doesn't exist or error fetching
			}
		}

		// Handle Bases formula properties
		if (propertyId.startsWith("formula.")) {
			try {
				const basesData = task.basesData;

				if (!basesData || typeof basesData.getValue !== "function") {
					return "";
				}

				// Use BasesEntry.getValue() to get formula result
				// BasesEntry is from Obsidian's Bases API (1.10.0+)
				const value = basesData.getValue(propertyId as any);

				// Handle null/undefined
				if (value === null || value === undefined) {
					return "";
				}

				// Extract raw value from Bases Value object
				const extracted = extractBasesValue(value);
				return extracted !== "" ? extracted : "";
			} catch (error) {
				console.debug(`[Taskly] Error computing formula ${propertyId}:`, error);
				return "[Formula Error]";
			}
		}

		// Try to get property from Bases API first (for custom properties)
		// This ensures we get the same value that Bases is displaying
		if (task.basesData && typeof task.basesData.getValue === "function") {
			try {
				// Try with "note." prefix first (most common for custom frontmatter properties)
				const notePropertyId = `note.${propertyId}`;
				const value = task.basesData.getValue(notePropertyId as any);
				if (value !== null && value !== undefined) {
					return extractBasesValue(value);
				}
			} catch (error) {
				// Property doesn't exist in Bases, try fallback
			}
		}

		// Fallback: try to get arbitrary property from frontmatter
		if (task.path) {
			const value = getFrontmatterValue(task.path, propertyId, plugin);
			if (value !== undefined) {
				return value;
			}
		}

		return null;
	} catch (error) {
		console.warn(`TaskCard: Error getting property ${propertyId}:`, error);
		return null;
	}
}

/**
 * Extract user property value with improved error handling and type safety
 */
function getUserPropertyValue(
	task: TaskInfo,
	propertyId: string,
	plugin: TasklyPlugin
): unknown {
	const fieldId = propertyId.slice(5);
	const userField = plugin.settings.userFields?.find((f) => f.id === fieldId);

	if (!userField?.key) {
		return null;
	}

	// Try task object first (backward compatibility)
	let value = (task as unknown as Record<string, unknown>)[userField.key];

	// Fall back to frontmatter if needed
	if (value === undefined) {
		value = getFrontmatterValue(task.path, userField.key, plugin);
	}

	return value;
}

/**
 * Safely extract frontmatter value with proper typing
 */
function getFrontmatterValue(taskPath: string, key: string, plugin: TasklyPlugin): unknown {
	try {
		const fileMetadata = plugin.app.metadataCache.getCache(taskPath);
		if (!fileMetadata?.frontmatter) {
			return undefined;
		}

		const frontmatter = fileMetadata.frontmatter as Record<string, unknown>;
		return frontmatter[key];
	} catch (error) {
		console.warn(`TaskCard: Error accessing frontmatter for ${taskPath}:`, error);
		return undefined;
	}
}

/**
 * Property renderer function type for better type safety
 */
type PropertyRenderer = (
	element: HTMLElement,
	value: unknown,
	task: TaskInfo,
	plugin: TasklyPlugin
) => void;

/**
 * Property renderers for cleaner separation of concerns
 */
const PROPERTY_RENDERERS: Record<string, PropertyRenderer> = {
	due: (element, value, task, plugin) => {
		if (typeof value === "string") {
			renderDueDateProperty(element, value, task, plugin);
		}
	},
	tags: (element, value, _, plugin) => {
		if (Array.isArray(value)) {
			// Always filter out the identifying task tag - it's redundant in task views
			const tagsToRender = value.filter(
				(tag) =>
					!FilterUtils.matchesHierarchicalTagExact(
						tag,
						plugin.settings.taskTag,
					),
			);

			// Only render if there are tags to display
			if (tagsToRender.length > 0) {
				renderTagsValue(element, tagsToRender);
			}
		}
	},
	recurrence: (element, value) => {
		if (typeof value === "string") {
			element.textContent = `Recurring: ${getRecurrenceDisplayText(value)}`;
		}
	},
	completeInstances: (element, value, task) => {
		if (Array.isArray(value) && value.length > 0) {
			const count = value.length;
			const skippedCount = task.skipped_instances?.length || 0;
			const total = count + skippedCount;

			if (total > 0) {
				const completionRate = Math.round((count / total) * 100);
				element.textContent = `✓ ${count} completed (${completionRate}%)`;
				element.classList.add("task-card__metadata-pill--completed-instances");
			} else {
				element.textContent = `✓ ${count} completed`;
				element.classList.add("task-card__metadata-pill--completed-instances");
			}
		}
	},
	skippedInstances: (element, value, task) => {
		if (Array.isArray(value) && value.length > 0) {
			const count = value.length;
			element.textContent = `⊘ ${count} skipped`;
			element.classList.add("task-card__metadata-pill--skipped-instances");
		}
	},
	completedDate: (element, value, task, plugin) => {
		if (typeof value === "string") {
			element.textContent = `Completed: ${formatDateTimeForDisplay(value, {
				dateFormat: "MMM d",
				showTime: false,
				userTimeFormat: plugin.settings.timeFormat,
			})}`;
		}
	},
	dateCreated: (element, value, task, plugin) => {
		if (typeof value === "string") {
			element.textContent = `Created: ${formatDateTimeForDisplay(value, {
				dateFormat: "MMM d",
				showTime: false,
				userTimeFormat: plugin.settings.timeFormat,
			})}`;
		}
	},
	dateModified: (element, value, task, plugin) => {
		if (typeof value === "string") {
			element.textContent = `Modified: ${formatDateTimeForDisplay(value, {
				dateFormat: "MMM d",
				showTime: false,
				userTimeFormat: plugin.settings.timeFormat,
			})}`;
		}
	},
	reminders: (element, value) => {
		// Show reminder count
		if (Array.isArray(value) && value.length > 0) {
			element.textContent = `${value.length} ${value.length === 1 ? "reminder" : "reminders"}`;
		}
	},
};

/**
 * Render a single property as a metadata element with improved organization
 */
function renderPropertyMetadata(
	container: HTMLElement,
	propertyId: string,
	task: TaskInfo,
	plugin: TasklyPlugin
): HTMLElement | null {
	const value = getPropertyValue(task, propertyId, plugin);

	if (!hasValidValue(value)) {
		return null;
	}

	const element = container.createEl("span", {
		cls: `task-card__metadata-property task-card__metadata-property--${propertyId.replace(":", "-")}`,
	});

	try {
		// Check if this is a user-configured name for a mapped field
		const mappingKey = plugin.fieldMapper.lookupMappingKey(propertyId);

		// Try using the mapping key as the renderer key
		const rendererKey = mappingKey || propertyId;

		if (rendererKey in PROPERTY_RENDERERS) {
			PROPERTY_RENDERERS[rendererKey](element, value, task, plugin);
		} else if (propertyId.startsWith("user:")) {
			renderUserProperty(element, propertyId, value, plugin);
		} else {
			// Fallback: render arbitrary property with generic format
			renderGenericProperty(element, propertyId, value, plugin);
		}

		// If the renderer didn't add any content, remove the element and return null
		if (!element.textContent && !element.hasChildNodes()) {
			element.remove();
			return null;
		}

		return element;
	} catch (error) {
		console.warn(`TaskCard: Error rendering property ${propertyId}:`, error);
		element.textContent = `${propertyId}: (error)`;
		return element;
	}
}

/**
 * Check if a value is valid for display
 */
function hasValidValue(value: any): boolean {
	return (
		value !== null &&
		value !== undefined &&
		!(Array.isArray(value) && value.length === 0) &&
		!(typeof value === "string" && value.trim() === "")
	);
}


/**
 * Render user-defined property with type safety and enhanced link/tag support
 */
function renderUserProperty(
	element: HTMLElement,
	propertyId: string,
	value: unknown,
	plugin: TasklyPlugin
): void {
	const fieldId = propertyId.slice(5);
	const userField = plugin.settings.userFields?.find((f) => f.id === fieldId);

	if (!userField) {
		element.textContent = `${fieldId}: (not found)`;
		return;
	}

	const fieldName = userField.displayName || fieldId;

	// Add field label
	element.createEl("span", { text: `${fieldName}: ` });

	// Create value container
	const valueContainer = element.createEl("span");

	// Create shared services to avoid redundant object creation
	const linkServices: LinkServices = {
		metadataCache: plugin.app.metadataCache,
		workspace: plugin.app.workspace,
	};

	// Check if the value might contain links or tags and render appropriately
	if (typeof value === "string" && value.trim() !== "") {
		const stringValue = value.trim();

		// Check if string contains links or tags
		if (
			stringValue.includes("[[") ||
			stringValue.includes("](") ||
			(stringValue.includes("#") && /\s#\w+|#\w+/.test(stringValue))
		) {
			renderTextWithLinks(valueContainer, stringValue, linkServices);
		} else {
			// Format according to field type
			const displayValue = formatUserPropertyValue(value, userField);
			valueContainer.textContent = displayValue;
		}
	} else if (userField.type === "list" && Array.isArray(value)) {
		// Handle list fields - avoid recursive renderPropertyValue call to prevent stack overflow
		const validItems = value.filter((item) => item !== null && item !== undefined);
		validItems.forEach((item, idx) => {
			if (idx > 0) valueContainer.appendChild(document.createTextNode(", "));

			// Render each list item directly instead of recursively calling renderPropertyValue
			if (typeof item === "string" && item.trim() !== "") {
				const itemString = item.trim();
				if (
					itemString.includes("[[") ||
					itemString.includes("](") ||
					(itemString.includes("#") && /\s#\w+|#\w+/.test(itemString))
				) {
					const itemContainer = valueContainer.createEl("span");
					renderTextWithLinks(itemContainer, itemString, linkServices);
				} else {
					valueContainer.appendChild(document.createTextNode(String(item)));
				}
			} else {
				valueContainer.appendChild(document.createTextNode(String(item)));
			}
		});
	} else {
		// Use standard formatting for other types or empty values
		const displayValue = formatUserPropertyValue(value, userField);
		if (displayValue.trim() !== "") {
			valueContainer.textContent = displayValue;
		} else {
			valueContainer.textContent = "(empty)";
		}
	}
}

/**
 * User field type definition for better type safety
 */
interface UserField {
	id: string;
	key: string;
	type: "text" | "number" | "date" | "boolean" | "list";
	displayName?: string;
}

/**
 * Render generic property with smart formatting and link detection
 */
function renderGenericProperty(
	element: HTMLElement,
	propertyId: string,
	value: unknown,
	plugin?: TasklyPlugin
): void {
	// Handle formula properties - show just the formula name, not "formula.TESTST"
	let displayName: string;
	if (propertyId.startsWith("formula.")) {
		displayName = propertyId.substring(8); // Remove "formula." prefix
	} else {
		displayName = propertyId.charAt(0).toUpperCase() + propertyId.slice(1);
	}

	// Add property label
	element.createEl("span", { text: `${displayName}: ` });

	// Create value container
	const valueContainer = element.createEl("span");

	if (Array.isArray(value)) {
		// Handle arrays - render each item separately to detect links
		// Extract Bases values from array items as they may be wrapped objects
		const filtered = value
			.map((v) => extractBasesValue(v))
			.filter((v) => v !== null && v !== undefined && v !== "");
		filtered.forEach((item, idx) => {
			if (idx > 0) valueContainer.appendChild(document.createTextNode(", "));
			renderPropertyValue(valueContainer, item, plugin);
		});
	} else {
		renderPropertyValue(valueContainer, value, plugin);
	}
}

/**
 * Render a single property value with link detection
 */
function renderPropertyValue(
	container: HTMLElement,
	value: unknown,
	plugin?: TasklyPlugin
): void {
	if (typeof value === "string" && plugin) {
		// Check if string contains links and render appropriately
		const linkServices: LinkServices = {
			metadataCache: plugin.app.metadataCache,
			workspace: plugin.app.workspace,
		};

		// If the string contains wikilinks, markdown links, or tags, render with enhanced support
		if (
			value.includes("[[") ||
			(value.includes("[") && value.includes("](")) ||
			(value.includes("#") && /\s#\w+|#\w+/.test(value))
		) {
			renderTextWithLinks(container, value, linkServices);
			return;
		}

		// Plain string
		container.appendChild(document.createTextNode(value));
		return;
	}

	let displayValue: string;

	if (typeof value === "object" && value !== null) {
		// Handle Date objects specially
		if (value instanceof Date) {
			displayValue = formatDateTimeForDisplay(value.toISOString(), {
				dateFormat: "MMM d, yyyy",
				timeFormat: "",
				showTime: false,
			});
		}
		// Handle objects with meaningful toString methods or simple key-value pairs
		else if (typeof value.toString === "function" && value.toString() !== "[object Object]") {
			displayValue = value.toString();
		}
		// For simple objects with a few key-value pairs, show them nicely
		else {
			const entries = Object.entries(value as Record<string, any>);
			if (entries.length <= 3) {
				displayValue = entries.map(([k, v]) => `${k}: ${v}`).join(", ");
			} else {
				// Fallback to JSON for complex objects
				displayValue = JSON.stringify(value);
			}
		}
	} else if (typeof value === "boolean") {
		// Handle booleans with checkmark/x symbols for better visual
		displayValue = value ? "✓" : "✗";
	} else if (typeof value === "number") {
		// Format numbers with appropriate precision
		displayValue = Number.isInteger(value) ? String(value) : value.toFixed(2);
	} else {
		// Handle strings and other primitive types
		displayValue = String(value);
	}

	// Truncate very long values to keep card readable
	if (displayValue.length > 100) {
		displayValue = displayValue.substring(0, 97) + "...";
	}

	container.appendChild(document.createTextNode(displayValue));
}

/**
 * Format user property value based on field type with improved type safety
 */
function formatUserPropertyValue(value: unknown, userField: UserField): string {
	if (value === null || value === undefined) return "";

	try {
		switch (userField.type) {
			case "text":
			case "number":
				return String(value);
			case "date":
				return formatDateTimeForDisplay(String(value), {
					dateFormat: "MMM d, yyyy",
					timeFormat: "",
					showTime: false,
				});
			case "boolean":
				return value ? "✓" : "✗";
			case "list":
				if (Array.isArray(value)) {
					return (value as unknown[]).flat(2).join(", ");
				}
				return String(value);
			default:
				return String(value);
		}
	} catch (error) {
		console.warn("TaskCard: Error formatting user property value:", error);
		return String(value);
	}
}

/**
 * Render due date property with click handler
 */
function renderDueDateProperty(
	element: HTMLElement,
	due: string,
	task: TaskInfo,
	plugin: TasklyPlugin
): void {
	const isDueToday = isTodayTimeAware(due);
	const isCompleted = plugin.statusManager.isCompletedStatus(task.status);
	const hideCompletedFromOverdue = plugin.settings?.hideCompletedFromOverdue ?? true;
	const isDueOverdue = isOverdueTimeAware(due, isCompleted, hideCompletedFromOverdue);

	const userTimeFormat = plugin.settings.timeFormat;
	let dueDateText = "";
	if (isDueToday) {
		const timeDisplay = formatDateTimeForDisplay(due, {
			dateFormat: "",
			showTime: true,
			userTimeFormat,
		});
		dueDateText = timeDisplay.trim() === "" ? "Due: Today" : `Due: Today at ${timeDisplay}`;
	} else if (isDueOverdue) {
		const display = formatDateTimeForDisplay(due, {
			dateFormat: "MMM d",
			showTime: true,
			userTimeFormat,
		});
		dueDateText = `Due: ${display} (overdue)`;
	} else {
		const display = formatDateTimeForDisplay(due, {
			dateFormat: "MMM d",
			showTime: true,
			userTimeFormat,
		});
		dueDateText = `Due: ${display}`;
	}

	element.textContent = dueDateText;
	element.classList.add("task-card__metadata-date", "task-card__metadata-date--due");
	if (isDueOverdue) {
		element.classList.add("task-card__metadata-date--overdue");
	}
	element.dataset.tnAction = "edit-date";
	element.dataset.tnDateType = "due";

	attachDateClickHandler(element, task, plugin, "due");
}

/**
 * Show or hide metadata line based on whether it has content
 */
function updateMetadataVisibility(metadataLine: HTMLElement, metadataElements: HTMLElement[]): void {
	metadataLine.style.display = metadataElements.length > 0 ? "" : "none";
}

/**
 * Create a minimalist, unified task card element
 *
 * @param task - The task to render
 * @param plugin - Taskly plugin instance
 * @param visibleProperties - IMPORTANT: Must be user-configured frontmatter property names
 *                            (e.g., "task-status", "complete_instances"), NOT internal FieldMapping keys.
 *                            If passing from settings.defaultVisibleProperties, convert using
 *                            convertInternalToUserProperties() first.
 * @param options - Optional rendering options (layout, targetDate, etc.)
 *
 * @example
 * // Correct: Convert internal names before passing
 * const props = plugin.settings.defaultVisibleProperties
 *   ? convertInternalToUserProperties(plugin.settings.defaultVisibleProperties, plugin)
 *   : undefined;
 * createTaskCard(task, plugin, props);
 *
 * // Correct: Pass frontmatter names from Bases
 * createTaskCard(task, plugin, ["complete_instances", "task-status"]);
 *
 * // WRONG: Don't pass internal keys directly
 * createTaskCard(task, plugin, ["completeInstances", "status"]); // ❌
 */
export function createTaskCard(
	task: TaskInfo,
	plugin: TasklyPlugin,
	visibleProperties?: string[],
	options: Partial<TaskCardOptions> = {}
): HTMLElement {
	const opts = { ...DEFAULT_TASK_CARD_OPTIONS, ...options };
	// Use fresh UTC-anchored "today" if no targetDate provided
	// This ensures recurring tasks show correct completion status for the current day
	const targetDate = opts.targetDate || (() => {
		const todayLocal = new Date();
		return new Date(Date.UTC(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate()));
	})();

	// Determine effective status for recurring tasks
	const effectiveStatus = task.recurrence
		? getEffectiveTaskStatus(task, targetDate)
		: task.status;

	// Determine layout mode first
	const layout = opts.layout || "default";

	// Main container with BEM class structure
	// Use span for inline layout to ensure proper inline flow in CodeMirror
	const card = document.createElement(layout === "inline" ? "span" : "div");

	// Store task path for circular reference detection
	(card as any)._taskPath = task.path;

	const isCompleted = task.recurrence
		? task.complete_instances?.includes(formatDateForStorage(targetDate)) || false // Direct check of complete_instances
		: plugin.statusManager.isCompletedStatus(effectiveStatus); // Regular tasks use status config
	const isSkipped = task.recurrence
		? task.skipped_instances?.includes(formatDateForStorage(targetDate)) || false // Direct check of skipped_instances
		: false; // Only recurring tasks can have skipped instances
	const isRecurring = !!task.recurrence;

	// Build BEM class names
	const cardClasses = ["task-card"];

	// Add layout modifier
	if (layout !== "default") {
		cardClasses.push(`task-card--layout-${layout}`);
	}

	// Add modifiers
	if (isCompleted) cardClasses.push("task-card--completed");
	if (isSkipped) cardClasses.push("task-card--skipped");
	if (task.archived) cardClasses.push("task-card--archived");
	if (isRecurring) cardClasses.push("task-card--recurring");

	// Add status modifier
	if (effectiveStatus) {
		cardClasses.push(`task-card--status-${effectiveStatus}`);
	}


	card.className = cardClasses.join(" ");
	card.dataset.taskPath = task.path;
	card.dataset.key = task.path; // For DOMReconciler compatibility
	card.dataset.status = effectiveStatus;

	// Create main row container for horizontal layout
	// Use span for inline layout to maintain inline flow
	const mainRow = card.createEl(layout === "inline" ? "span" : "div", { cls: "task-card__main-row" });

	// Apply status colors as CSS custom properties
	const statusConfig = plugin.statusManager.getStatusConfig(effectiveStatus);
	if (statusConfig) {
		card.style.setProperty("--current-status-color", statusConfig.color);
	}

	// Set next status color for hover preview
	const nextStatus = plugin.statusManager.getNextStatus(effectiveStatus);
	const nextStatusConfig = plugin.statusManager.getStatusConfig(nextStatus);
	if (nextStatusConfig) {
		card.style.setProperty("--next-status-color", nextStatusConfig.color);
	}

	// Status indicator dot (conditional based on visible properties and options)
	let statusDot: HTMLElement | null = null;
	const shouldShowStatus =
		!opts.hideStatusIndicator &&
		(!visibleProperties ||
			visibleProperties.some((prop) => isPropertyForField(prop, "status", plugin)));
	if (shouldShowStatus) {
		statusDot = mainRow.createEl("span", { cls: "task-card__status-dot" });
		if (statusConfig) {
			statusDot.style.borderColor = statusConfig.color;
			// If status has an icon configured, render it instead of colored dot
			if (statusConfig.icon) {
				statusDot.addClass("task-card__status-dot--icon");
				setIcon(statusDot, statusConfig.icon);
			}
		}
	}

	// Add tooltip to status dot showing next action
	if (statusDot) {
		if (isRecurring && isCompleted) {
			setTooltip(statusDot, "Completed for this date", { placement: "top" });
		} else if (nextStatusConfig) {
			setTooltip(statusDot, `Mark as ${nextStatusConfig.label.toLowerCase()}`, { placement: "top" });
		}
	}

	// Add click handler to cycle through statuses
	if (statusDot) {
		// Prevent mousedown from propagating to editor (fixes inline widget de-rendering)
		statusDot.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		statusDot.addEventListener("click", createStatusCycleHandler(task, plugin, card, statusDot, targetDate));
	}

	// TABLE LAYOUT: Single row with columns (Status | Name+Tags | Due | Added)
	if (layout === "table") {
		// Name column (with inline tags)
		const nameColumn = mainRow.createEl("div", { cls: "task-card__col task-card__col--name" });
		const titleTextEl = nameColumn.createSpan({ cls: "task-card__title-text", text: task.title });
		if (isCompleted) {
			titleTextEl.classList.add("completed");
		}

		// Tags inline with name
		if (task.tags && task.tags.length > 0) {
			// Always filter out the identifying task tag - it's redundant in task views
			const tagsToRender = task.tags.filter(
				(tag) => !FilterUtils.matchesHierarchicalTagExact(tag, plugin.settings.taskTag)
			);
			if (tagsToRender.length > 0) {
				const tagsInline = nameColumn.createSpan({ cls: "task-card__tags-inline" });
				renderTagsValue(tagsInline, tagsToRender);
			}
		}

		// Due Date column
		const dueColumn = mainRow.createEl("div", { cls: "task-card__col task-card__col--due" });
		if (task.due) {
			const dueText = formatDateTimeForDisplay(task.due, {
				dateFormat: "MMM d",
				showTime: false,
				userTimeFormat: plugin.settings.timeFormat,
			});
			dueColumn.textContent = dueText;
		}

		// Date Added column
		const dateColumn = mainRow.createEl("div", { cls: "task-card__col task-card__col--date" });
		if (task.dateCreated) {
			const dateText = formatDateTimeForDisplay(task.dateCreated, {
				dateFormat: "MMM d",
				showTime: false,
				userTimeFormat: plugin.settings.timeFormat,
			});
			dateColumn.textContent = dateText;
		}

		// Context menu icon (appears on hover) - at the end
		const contextIcon = mainRow.createEl("div", {
			cls: "task-card__context-menu",
			attr: { "aria-label": "Task options" },
		});
		setIcon(contextIcon, "ellipsis-vertical");
		setTooltip(contextIcon, "Task options", { placement: "top" });
		contextIcon.addEventListener("click", async (e) => {
			e.stopPropagation();
			e.preventDefault();
			await showTaskContextMenu(e as MouseEvent, task.path, plugin, targetDate);
		});

		// Add click handlers
		const { clickHandler, dblclickHandler, contextmenuHandler } = createTaskClickHandler({
			task,
			plugin,
			contextMenuHandler: async (e) => {
				const path = card.dataset.taskPath;
				if (!path) return;
				await showTaskContextMenu(e, path, plugin, targetDate);
			},
		});
		card.addEventListener("click", clickHandler);
		card.addEventListener("dblclick", dblclickHandler);
		card.addEventListener("contextmenu", contextmenuHandler);
		card.addEventListener("mouseover", createTaskHoverHandler(task, plugin));

		return card;
	}

	// DEFAULT/COMPACT/INLINE LAYOUTS: Standard card structure
	// Content container
	const contentContainer = mainRow.createEl(layout === "inline" ? "span" : "div", { cls: "task-card__content" });

	// Badge area for secondary indicators (only in non-inline mode)
	const badgesContainer = layout !== "inline" ? mainRow.createEl("div", { cls: "task-card__badges" }) : null;

	if (badgesContainer) {
		// Recurring indicator
		if (task.recurrence) {
			const recurrenceTooltip = `Recurring: ${getRecurrenceDisplayText(task.recurrence)} (click to change)`;
			createBadgeIndicator({
				container: badgesContainer,
				className: "task-card__recurring-indicator",
				icon: "rotate-ccw",
				tooltip: recurrenceTooltip,
				onClick: createRecurrenceClickHandler(task, plugin),
			});
		}

		// Reminder indicator
		if (task.reminders && task.reminders.length > 0) {
			const count = task.reminders.length;
			const reminderTooltip = count === 1 ? "1 reminder set (click to manage)" : `${count} reminders set (click to manage)`;
			createBadgeIndicator({
				container: badgesContainer,
				className: "task-card__reminder-indicator",
				icon: "bell",
				tooltip: reminderTooltip,
				onClick: createReminderClickHandler(task, plugin),
			});
		}

	}

	// Context menu icon (appears on hover)
	const contextIcon = mainRow.createEl("div", {
		cls: "task-card__context-menu",
		attr: {
			"aria-label": "Task options",
		},
	});

	// Use Obsidian's built-in ellipsis-vertical icon
	setIcon(contextIcon, "ellipsis-vertical");
	setTooltip(contextIcon, "Task options", { placement: "top" });

	contextIcon.addEventListener("click", async (e) => {
		e.stopPropagation();
		e.preventDefault();
		await showTaskContextMenu(e as MouseEvent, task.path, plugin, targetDate);
	});

	// First line: Task title
	const titleEl = contentContainer.createEl(layout === "inline" ? "span" : "div", { cls: "task-card__title" });
	const titleTextEl = titleEl.createSpan({ cls: "task-card__title-text", text: task.title });

	if (isCompleted) {
		titleEl.classList.add("completed");
		titleTextEl.classList.add("completed");
	}

	// Second line: Metadata (dynamic based on visible properties)
	const metadataLine = contentContainer.createEl(layout === "inline" ? "span" : "div", { cls: "task-card__metadata" });
	const metadataElements: HTMLElement[] = [];

	// Get properties to display
	const propertiesToShow =
		visibleProperties ||
		(plugin.settings.defaultVisibleProperties
			? convertInternalToUserProperties(plugin.settings.defaultVisibleProperties, plugin)
			: getDefaultVisibleProperties(plugin));

	// Render each visible property
	for (const propertyId of propertiesToShow) {
		// Skip status as it's rendered separately
		if (isPropertyForField(propertyId, "status", plugin)) {
			continue;
		}

		const element = renderPropertyMetadata(metadataLine, propertyId, task, plugin);
		if (element) {
			metadataElements.push(element);
		}
	}

	// Show/hide metadata line based on content
	updateMetadataVisibility(metadataLine, metadataElements);

	// Add click handlers with single/double click distinction
	const { clickHandler, dblclickHandler, contextmenuHandler } = createTaskClickHandler({
		task,
		plugin,
		contextMenuHandler: async (e) => {
			const path = card.dataset.taskPath;
			if (!path) return;
			await showTaskContextMenu(e, path, plugin, targetDate);
		},
	});

	card.addEventListener("click", clickHandler);
	card.addEventListener("dblclick", dblclickHandler);
	card.addEventListener("contextmenu", contextmenuHandler);

	// Hover preview
	card.addEventListener("mouseover", createTaskHoverHandler(task, plugin));

	return card;
}

/**
 * Show context menu for task card
 */
export async function showTaskContextMenu(
	event: MouseEvent,
	taskPath: string,
	plugin: TasklyPlugin,
	targetDate: Date
) {
	const file = plugin.app.vault.getAbstractFileByPath(taskPath);
	const showFileMenuFallback = () => {
		if (file instanceof TFile) {
			showFileContextMenu(event, file, plugin);
		}
	};

	try {
		// Always fetch fresh task data - ignore any stale captured data
		const task = await plugin.cacheManager.getTaskInfo(taskPath);
		if (!task) {
			showFileMenuFallback();
			return;
		}

		const contextMenu = new TaskContextMenu({
			task: task,
			plugin: plugin,
			targetDate: targetDate,
			onUpdate: () => {
				// Trigger refresh of views
				plugin.app.workspace.trigger("taskly:refresh-views");
			},
		});

		contextMenu.show(event);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error("Error creating context menu:", {
			error: errorMessage,
			taskPath,
		});
		new Notice(`Failed to create context menu: ${errorMessage}`);
		showFileMenuFallback();
	}
}

function showFileContextMenu(event: MouseEvent, file: TFile, plugin: TasklyPlugin) {
	const menu = new Menu();

	let populated = false;
	try {
		plugin.app.workspace.trigger("file-menu", menu, file, "taskly-bases-view");
		populated = (menu as any).items?.length > 0;
	} catch (error) {
		populated = false;
	}

	if (!populated) {
		menu.addItem((item) => {
			item.setTitle("Open");
			item.setIcon("file-text");
			item.onClick(() => {
				plugin.app.workspace.getLeaf(false).openFile(file);
			});
		});
		menu.addItem((item) => {
			item.setTitle("Open in new tab");
			item.setIcon("external-link");
			item.onClick(() => {
				plugin.app.workspace.openLinkText(file.path, "", true);
			});
		});
	}

	menu.showAtMouseEvent(event);
}

/**
 * Update an existing task card with new data
 */
export function updateTaskCard(
	element: HTMLElement,
	task: TaskInfo,
	plugin: TasklyPlugin,
	visibleProperties?: string[],
	options: Partial<TaskCardOptions> = {}
): void {
	const opts = { ...DEFAULT_TASK_CARD_OPTIONS, ...options };
	// Use fresh UTC-anchored "today" if no targetDate provided
	// This ensures recurring tasks show correct completion status for the current day
	const targetDate = opts.targetDate || (() => {
		const todayLocal = new Date();
		return new Date(Date.UTC(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate()));
	})();

	// Update effective status
	const effectiveStatus = task.recurrence
		? getEffectiveTaskStatus(task, targetDate)
		: task.status;

	// Update main element classes using BEM structure
	const isCompleted = task.recurrence
		? task.complete_instances?.includes(formatDateForStorage(targetDate)) || false // Direct check of complete_instances
		: plugin.statusManager.isCompletedStatus(effectiveStatus); // Regular tasks use status config
	const isSkipped = task.recurrence
		? task.skipped_instances?.includes(formatDateForStorage(targetDate)) || false // Direct check of skipped_instances
		: false; // Only recurring tasks can have skipped instances
	const isRecurring = !!task.recurrence;

	// Build BEM class names for update
	const cardClasses = ["task-card"];

	// Add modifiers
	if (isCompleted) cardClasses.push("task-card--completed");
	if (isSkipped) cardClasses.push("task-card--skipped");
	if (task.archived) cardClasses.push("task-card--archived");
	if (isRecurring) cardClasses.push("task-card--recurring");

	// Add status modifier
	if (effectiveStatus) {
		cardClasses.push(`task-card--status-${effectiveStatus}`);
	}


	element.className = cardClasses.join(" ");
	element.dataset.status = effectiveStatus;

	// Get the main row container
	const mainRow = element.querySelector(".task-card__main-row") as HTMLElement;

	// Update status colors
	const statusConfig = plugin.statusManager.getStatusConfig(effectiveStatus);
	if (statusConfig) {
		element.style.setProperty("--current-status-color", statusConfig.color);
	}

	// Update next status color for hover preview
	const nextStatus = plugin.statusManager.getNextStatus(effectiveStatus);
	const nextStatusConfig = plugin.statusManager.getStatusConfig(nextStatus);
	if (nextStatusConfig) {
		element.style.setProperty("--next-status-color", nextStatusConfig.color);
	}

	// Update checkbox if present
	const checkbox = element.querySelector(".task-card__checkbox") as HTMLInputElement;
	if (checkbox) {
		checkbox.checked = plugin.statusManager.isCompletedStatus(effectiveStatus);
	}

	// Update status dot (conditional based on visible properties)
	const shouldShowStatus =
		!visibleProperties ||
		visibleProperties.some((prop) => isPropertyForField(prop, "status", plugin));
	const statusDot = element.querySelector(".task-card__status-dot") as HTMLElement;

	if (shouldShowStatus) {
		if (statusDot) {
			// Update existing dot
			if (statusConfig) {
				statusDot.style.borderColor = statusConfig.color;
			}
		} else if (mainRow) {
			// Add missing dot
			const newStatusDot = mainRow.createEl("span", { cls: "task-card__status-dot" });
			if (statusConfig) {
				newStatusDot.style.borderColor = statusConfig.color;
			}

			// Add click handler to mark done
			newStatusDot.addEventListener(
				"click",
				createStatusCycleHandler(task, plugin, element, newStatusDot, targetDate)
			);

			// Insert at the beginning after checkbox
			const checkbox = element.querySelector(".task-card__checkbox");
			if (checkbox) {
				checkbox.insertAdjacentElement("afterend", newStatusDot);
			} else {
				mainRow.insertBefore(newStatusDot, mainRow.firstChild);
			}
		}
	} else if (statusDot) {
		// Remove dot if it shouldn't be visible
		statusDot.remove();
	}

	// Update badge indicators using helper
	const badgesContainer = element.querySelector(".task-card__badges") as HTMLElement;

	// Update recurring indicator
	const recurrenceTooltip = task.recurrence
		? `Recurring: ${getRecurrenceDisplayText(task.recurrence)} (click to change)`
		: "";
	updateBadgeIndicator(element, ".task-card__recurring-indicator", {
		shouldExist: !!task.recurrence,
		className: "task-card__recurring-indicator",
		icon: "rotate-ccw",
		tooltip: recurrenceTooltip,
		onClick: createRecurrenceClickHandler(task, plugin),
	});

	// Update reminder indicator
	const hasReminders = !!(task.reminders && task.reminders.length > 0);
	const reminderCount = task.reminders?.length || 0;
	const reminderTooltip = reminderCount === 1
		? "1 reminder set (click to manage)"
		: `${reminderCount} reminders set (click to manage)`;
	updateBadgeIndicator(element, ".task-card__reminder-indicator", {
		shouldExist: hasReminders,
		className: "task-card__reminder-indicator",
		icon: "bell",
		tooltip: reminderTooltip,
		onClick: createReminderClickHandler(task, plugin),
	});

	// Update title
	const titleText = element.querySelector(".task-card__title-text") as HTMLElement;
	const titleContainer = element.querySelector(".task-card__title") as HTMLElement;
	const titleIsCompleted = isCompleted;
	if (titleText) {
		titleText.textContent = task.title;
		titleText.classList.toggle("completed", titleIsCompleted);
	}
	if (titleContainer) {
		titleContainer.classList.toggle("completed", titleIsCompleted);
	}

	// Update metadata line
	const metadataLine = element.querySelector(".task-card__metadata") as HTMLElement;
	if (metadataLine) {
		// Clear the metadata line and rebuild with DOM elements to support inline interactions
		metadataLine.innerHTML = "";
		const metadataElements: HTMLElement[] = [];

		// Get properties to display
		const propertiesToShow =
			visibleProperties ||
			(plugin.settings.defaultVisibleProperties
				? convertInternalToUserProperties(plugin.settings.defaultVisibleProperties, plugin)
				: getDefaultVisibleProperties(plugin));

		for (const propertyId of propertiesToShow) {
			// Skip status as it's rendered separately
			if (isPropertyForField(propertyId, "status", plugin)) {
				continue;
			}

			const element = renderPropertyMetadata(metadataLine, propertyId, task, plugin);
			if (element) {
				metadataElements.push(element);
			}
		}

		// Hide metadata line if empty
		updateMetadataVisibility(metadataLine, metadataElements);
	}

	// Animation is now handled separately - don't add it here during reconciler updates
}

/**
 * Confirmation modal for task deletion
 */
class DeleteTaskConfirmationModal extends Modal {
	private task: TaskInfo;
	private onConfirm: () => Promise<void>;

	constructor(app: App, task: TaskInfo, onConfirm: () => Promise<void>) {
		super(app);
		this.task = task;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Delete Task" });

		const description = contentEl.createEl("p");
		description.appendText('Are you sure you want to delete the task "');
		description.createEl("strong", { text: this.task.title });
		description.appendText('"?');

		contentEl.createEl("p", {
			cls: "mod-warning",
			text: "This action cannot be undone. The task file will be permanently deleted.",
		});

		const buttonContainer = contentEl.createEl("div", { cls: "modal-button-container" });
		buttonContainer.style.display = "flex";
		buttonContainer.style.gap = "10px";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.marginTop = "20px";

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		const deleteButton = buttonContainer.createEl("button", {
			text: "Delete",
			cls: "mod-warning",
		});
		deleteButton.style.backgroundColor = "var(--color-red)";
		deleteButton.style.color = "white";

		deleteButton.addEventListener("click", async () => {
			try {
				await this.onConfirm();
				this.close();
				new Notice("Task deleted successfully");
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				new Notice(`Failed to delete task: ${errorMessage}`);
				console.error("Error in delete confirmation:", error);
			}
		});

		// Focus the cancel button by default
		cancelButton.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Show delete confirmation modal and handle task deletion
 */
export async function showDeleteConfirmationModal(
	task: TaskInfo,
	plugin: TasklyPlugin
): Promise<void> {
	return new Promise((resolve, reject) => {
		const modal = new DeleteTaskConfirmationModal(plugin.app, task, async () => {
			try {
				await plugin.taskService.deleteTask(task);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
		modal.open();
	});
}

/**
 * Clean up event listeners and resources for a task card
 */
export function cleanupTaskCard(card: HTMLElement): void {
	// Note: Other event listeners on the card itself are automatically cleaned up
	// when the card is removed from the DOM. We only need to manually clean up
	// listeners that we store references to.
}
