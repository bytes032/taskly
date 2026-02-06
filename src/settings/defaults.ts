import { FieldMapping, StatusConfig } from "../types";
import {
	TasklySettings,
	TaskCreationDefaults,
	NLPTriggersConfig,
} from "../types/settings";

/**
 * Internal field names for default visible properties.
 * These are FieldMapping keys that will be converted to user-configured property names.
 */
export const DEFAULT_INTERNAL_VISIBLE_PROPERTIES: Array<keyof FieldMapping | "tags"> = [
	"status",
	"due",
	"tags",
];

// Default field mapping maintains backward compatibility
export const DEFAULT_FIELD_MAPPING: FieldMapping = {
	title: "title",
	status: "completed",
	due: "due",
	completedDate: "completedDate",
	dateCreated: "dateCreated",
	dateModified: "dateModified",
	recurrence: "recurrence",
	recurrenceAnchor: "recurrence_anchor",
	archiveTag: "archived",
	completeInstances: "complete_instances",
	skippedInstances: "skipped_instances",
	reminders: "reminders",
};

// Default status configuration matches current hardcoded behavior
export const DEFAULT_STATUSES: StatusConfig[] = [
	{
		id: "open",
		value: "open",
		label: "To do",
		color: "#808080",
		isCompleted: false,
		order: 0,
		autoArchive: false,
		autoArchiveDelay: 5,
	},
	{
		id: "done",
		value: "done",
		label: "Done",
		color: "#00aa00",
		isCompleted: true,
		order: 1,
		autoArchive: true,
		autoArchiveDelay: 0,
	},
];

export const DEFAULT_TASK_CREATION_DEFAULTS: TaskCreationDefaults = {
	defaultTags: "",
	defaultRecurrence: "none",
	defaultDueDate: "none",
	bodyTemplate: "",
	useBodyTemplate: false,
	defaultReminders: [],
};

// Default NLP triggers configuration
export const DEFAULT_NLP_TRIGGERS: NLPTriggersConfig = {
	triggers: [
		{
			propertyId: "tags",
			trigger: "#",
			enabled: true,
		},
		{
			propertyId: "status",
			trigger: "*",
			enabled: true,
		},
	],
};

export const DEFAULT_SETTINGS: TasklySettings = {
	tasksFolder: "_taskly/tasks",
	moveArchivedTasks: true,
	archiveFolder: "_taskly/archive",
	taskTag: "task",
	taskIdentificationMethod: "tag", // Default to tag-based identification
	taskPropertyName: "",
	taskPropertyValue: "",
	excludedFolders: "", // Default to no excluded folders
	defaultTaskStatus: "open",
	// Task filename defaults
	taskFilenameFormat: "zettel", // Keep existing behavior as default
	storeTitleInFilename: true,
	customFilenameTemplate: "{title}", // Simple title template
	// Task creation defaults
	taskCreationDefaults: DEFAULT_TASK_CREATION_DEFAULTS,
	// Editor defaults
	enableTaskLinkOverlay: true,
	disableOverlayOnAlias: false,
	enableInstantTaskConvert: true,
	useDefaultsOnInstantConvert: true,
	// NLP triggers
	nlpTriggers: DEFAULT_NLP_TRIGGERS,

	singleClickAction: "none",
	doubleClickAction: "openNote",
	// Inline task conversion defaults
	inlineTaskConvertFolder: "{{currentNotePath}}",
	// Customization defaults
	fieldMapping: DEFAULT_FIELD_MAPPING,
	customStatuses: DEFAULT_STATUSES,
	// Display formatting defaults
	timeFormat: "24",
	// Overdue behavior defaults
	hideCompletedFromOverdue: true,
	// Notification defaults
	enableNotifications: true,
	notificationType: "system",
	// HTTP API defaults
	enableAPI: false,
	apiPort: 8080,
	apiAuthToken: "",
	// User Fields defaults (multiple)
	userFields: [],
	// Default visible properties for task cards
	defaultVisibleProperties: [
		"status", // Status dot
		"due", // Due date
		"tags", // Tags
	],
	// Default visible properties for inline task cards (more compact by default)
	inlineVisibleProperties: ["status", "due", "recurrence"],
	// Bases integration defaults
	enableBasesSWR: true,
	// Command-to-file mappings for view commands (v4)
	commandFileMapping: {
		'open-table-view': '_taskly/views/table-default.base',
	},
};
