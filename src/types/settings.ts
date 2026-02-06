import { FieldMapping, StatusConfig, WebhookConfig } from "../types";
import type { FileFilterConfig } from "../suggest/FileSuggestHelper";

// New multi-field mapping for MVP
export interface UserMappedField {
	id: string; // stable id used in filters (e.g., 'effort')
	displayName: string;
	key: string; // frontmatter key
	type: "text" | "number" | "date" | "boolean" | "list";
	autosuggestFilter?: FileFilterConfig; // Optional filter configuration for file suggestions
	defaultValue?: string | number | boolean | string[]; // Default value for the field
}

/**
 * Configuration for a single NLP trigger
 */
export interface PropertyTriggerConfig {
	propertyId: string; // 'tags', 'status', or user field id
	trigger: string; // The trigger string (e.g., '@', 'context:', '#')
	enabled: boolean; // Whether this trigger is active
}

/**
 * NLP triggers configuration
 */
export interface NLPTriggersConfig {
	triggers: PropertyTriggerConfig[];
}

export interface TasklySettings {
	tasksFolder: string; // Now just a default location for new tasks
	moveArchivedTasks: boolean; // Whether to move tasks to archive folder when archived
	archiveFolder: string; // Folder to move archived tasks to, supports template variables
	taskTag: string; // The tag that identifies tasks
	taskIdentificationMethod: "tag" | "property"; // Method to identify tasks
	taskPropertyName: string; // Property name for property-based identification
	taskPropertyValue: string; // Property value for property-based identification
	excludedFolders: string; // Comma-separated list of folders to exclude from Notes tab
	defaultTaskStatus: string; // Changed to string to support custom statuses
	// Task filename settings
	taskFilenameFormat: "title" | "zettel" | "timestamp" | "custom";
	storeTitleInFilename: boolean;
	customFilenameTemplate: string; // Template for custom format
	// Task creation defaults
	taskCreationDefaults: TaskCreationDefaults;
	// Editor settings
	enableTaskLinkOverlay: boolean;
	disableOverlayOnAlias: boolean;
	enableInstantTaskConvert: boolean;
	useDefaultsOnInstantConvert: boolean;

	// NLP triggers configuration
	nlpTriggers: NLPTriggersConfig;

	singleClickAction: "openNote" | "none";
	doubleClickAction: "openNote" | "none";
	// Inline task conversion settings
	inlineTaskConvertFolder: string; // Folder for inline task conversion, supports {{currentNotePath}} and {{currentNoteTitle}}
	/** Optional debounce in milliseconds for inline file suggestions (0 = disabled) */
	suggestionDebounceMs?: number;
	// Customization settings
	fieldMapping: FieldMapping;
	customStatuses: StatusConfig[];
	// Display formatting
	timeFormat: "12" | "24";
	// Overdue behavior settings
	hideCompletedFromOverdue: boolean;
	// Notification settings
	enableNotifications: boolean;
	notificationType: "in-app" | "system";
	// HTTP API settings
	enableAPI: boolean;
	apiPort: number;
	apiAuthToken: string;
	// Webhook settings
	webhooks: WebhookConfig[];
	// User-defined field mappings (optional)
	userFields?: UserMappedField[];
	// Default visible properties for task cards (when no saved view is active)
	defaultVisibleProperties?: string[];
	// Default visible properties for inline task cards (task link widgets in editor)
	inlineVisibleProperties?: string[];
	// Bases integration settings
	enableBases: boolean;
	enableBasesSWR: boolean;
	// Command-to-file mappings for view commands (v4)
	commandFileMapping: {
		'open-table-view': string;
		[key: string]: string; // Allow string indexing
	};
	// Recurring task behavior
}

export interface DefaultReminder {
	id: string;
	type: "relative" | "absolute";
	// For relative reminders
	relatedTo?: "due";
	offset?: number; // Amount in specified unit
	unit?: "minutes" | "hours" | "days";
	direction?: "before" | "after";
	// For absolute reminders
	absoluteTime?: string; // Time in HH:MM format
	absoluteDate?: string; // Date in YYYY-MM-DD format
	description?: string;
}

export interface TaskCreationDefaults {
	// Pre-fill options
	defaultTags: string; // Comma-separated list
	defaultRecurrence: "none" | "daily" | "weekly" | "monthly" | "yearly";
	// Date defaults
	defaultDueDate: "none" | "today" | "tomorrow" | "next-week";
	// Body template settings
	bodyTemplate: string; // Path to template file for task body, empty = no template
	useBodyTemplate: boolean; // Whether to use body template by default
	// Reminder defaults
	defaultReminders: DefaultReminder[];
}
