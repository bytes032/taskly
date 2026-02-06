// View types (active views)
export const TASK_LIST_VIEW_TYPE = "taskly-task-list-view";

// Event types
export const EVENT_DATE_SELECTED = "date-selected";
export const EVENT_TAB_CHANGED = "tab-changed";
export const EVENT_DATA_CHANGED = "data-changed";
export const EVENT_TASK_UPDATED = "task-updated";
export const EVENT_TASK_DELETED = "task-deleted";
export const EVENT_DATE_CHANGED = "date-changed";

// Task sorting and grouping types
export type TaskSortKey =
	| "due"
	| "status"
	| "title"
	| "dateCreated"
	| "completedDate"
	| "tags"
	| `user:${string}`;
export type TaskGroupKey =
	| "none"
	| "due"
	| "status"
	| "tags"
	| "completedDate"
	| `user:${string}`;
export type SortDirection = "asc" | "desc";

// New Advanced Filtering System Types

// A single filter rule
export interface FilterCondition {
	type: "condition";
	id: string; // Unique ID for DOM management
	property: FilterProperty; // The field to filter on (e.g., 'status', 'due', 'file.ctime')
	operator: FilterOperator; // The comparison operator (e.g., 'is', 'contains')
	value: string | string[] | number | boolean | null; // The value for comparison
}

// A logical grouping of conditions or other groups
export interface FilterGroup {
	type: "group";
	id: string; // Unique ID for DOM management and state tracking
	conjunction: "and" | "or"; // How children are evaluated
	children: FilterNode[]; // The contents of the group
}

// Union type for filter nodes
export type FilterNode = FilterCondition | FilterGroup;

// The main query structure, a single root group with display properties
export interface FilterQuery extends FilterGroup {
	sortKey?: TaskSortKey;
	sortDirection?: SortDirection;
	groupKey?: TaskGroupKey;
	// Secondary grouping key for hierarchical grouping (optional)
	subgroupKey?: TaskGroupKey;
}

// Property and operator definitions for the advanced filtering system
export type FilterProperty =
	// Placeholder for "Select..." option
	| ""
	// Text properties
	| "title"
	| "path"
	// Select properties
	| "status"
	| "tags"
	// Date properties
	| "due"
	| "completedDate"
	| "dateCreated"
	| "dateModified"
	// Boolean properties
	| "archived"
	// Special properties
	| "recurrence"
	| "status.isCompleted"
	// Dynamic user-mapped properties
	| `user:${string}`;

export type FilterOperator =
	// Basic comparison
	| "is"
	| "is-not"
	// Text operators
	| "contains"
	| "does-not-contain"
	// Date operators
	| "is-before"
	| "is-after"
	| "is-on-or-before"
	| "is-on-or-after"
	// Existence operators
	| "is-empty"
	| "is-not-empty"
	// Boolean operators
	| "is-checked"
	| "is-not-checked"
	// Numeric operators
	| "is-greater-than"
	| "is-less-than"
	| "is-greater-than-or-equal"
	| "is-less-than-or-equal";

// Property metadata for UI generation
export interface PropertyDefinition {
	id: FilterProperty;
	label: string;
	category: "text" | "select" | "date" | "boolean" | "numeric" | "special";
	supportedOperators: FilterOperator[];
	valueInputType: "text" | "select" | "multi-select" | "date" | "number" | "none";
}

// Predefined property definitions
export const FILTER_PROPERTIES: PropertyDefinition[] = [
	// Text properties
	{
		id: "title",
		label: "Title",
		category: "text",
		supportedOperators: [
			"is",
			"is-not",
			"contains",
			"does-not-contain",
			"is-empty",
			"is-not-empty",
		],
		valueInputType: "text",
	},
	{
		id: "path",
		label: "Path",
		category: "select",
		supportedOperators: ["contains", "does-not-contain", "is-empty", "is-not-empty"],
		valueInputType: "select",
	},

	// Select properties
	{
		id: "status",
		label: "Done",
		category: "boolean",
		supportedOperators: ["is-checked", "is-not-checked"],
		valueInputType: "none",
	},
	{
		id: "tags",
		label: "Tags",
		category: "select",
		supportedOperators: ["contains", "does-not-contain", "is-empty", "is-not-empty"],
		valueInputType: "select",
	},

	// Date properties
	{
		id: "due",
		label: "Due Date",
		category: "date",
		supportedOperators: [
			"is",
			"is-not",
			"is-before",
			"is-after",
			"is-on-or-before",
			"is-on-or-after",
			"is-empty",
			"is-not-empty",
		],
		valueInputType: "date",
	},
	{
		id: "completedDate",
		label: "Completed Date",
		category: "date",
		supportedOperators: [
			"is",
			"is-not",
			"is-before",
			"is-after",
			"is-on-or-before",
			"is-on-or-after",
			"is-empty",
			"is-not-empty",
		],
		valueInputType: "date",
	},
	{
		id: "dateCreated",
		label: "Created Date",
		category: "date",
		supportedOperators: [
			"is",
			"is-not",
			"is-before",
			"is-after",
			"is-on-or-before",
			"is-on-or-after",
			"is-empty",
			"is-not-empty",
		],
		valueInputType: "date",
	},
	{
		id: "dateModified",
		label: "Modified Date",
		category: "date",
		supportedOperators: [
			"is",
			"is-not",
			"is-before",
			"is-after",
			"is-on-or-before",
			"is-on-or-after",
			"is-empty",
			"is-not-empty",
		],
		valueInputType: "date",
	},

	// Boolean properties
	{
		id: "archived",
		label: "Archived",
		category: "boolean",
		supportedOperators: ["is-checked", "is-not-checked"],
		valueInputType: "none",
	},

	// Special properties
	{
		id: "recurrence",
		label: "Recurrence",
		category: "special",
		supportedOperators: ["is-empty", "is-not-empty"],
		valueInputType: "none",
	},
	{
		id: "status.isCompleted",
		label: "Completed",
		category: "boolean",
		supportedOperators: ["is-checked", "is-not-checked"],
		valueInputType: "none",
	},
];

// Operator metadata for UI generation
export interface OperatorDefinition {
	id: FilterOperator;
	label: string;
	requiresValue: boolean;
}

// Predefined operator definitions
export const FILTER_OPERATORS: OperatorDefinition[] = [
	{ id: "is", label: "is", requiresValue: true },
	{ id: "is-not", label: "is not", requiresValue: true },
	{ id: "contains", label: "contains", requiresValue: true },
	{ id: "does-not-contain", label: "does not contain", requiresValue: true },
	{ id: "is-before", label: "is before", requiresValue: true },
	{ id: "is-after", label: "is after", requiresValue: true },
	{ id: "is-on-or-before", label: "is on or before", requiresValue: true },
	{ id: "is-on-or-after", label: "is on or after", requiresValue: true },
	{ id: "is-empty", label: "is empty", requiresValue: false },
	{ id: "is-not-empty", label: "is not empty", requiresValue: false },
	{ id: "is-checked", label: "is checked", requiresValue: false },
	{ id: "is-not-checked", label: "is not checked", requiresValue: false },
	{ id: "is-greater-than", label: "is greater than", requiresValue: true },
	{ id: "is-less-than", label: "is less than", requiresValue: true },
	{ id: "is-greater-than-or-equal", label: "is equal or greater than", requiresValue: true },
	{ id: "is-less-than-or-equal", label: "is equal or less than", requiresValue: true },
];

export interface FilterOptions {
	statuses: readonly StatusConfig[];
	tags: readonly string[];
	folders: readonly string[];
	// Dynamic user-defined properties built from settings.userFields
	userProperties?: readonly PropertyDefinition[];
}

// Time and date related types
export interface TimeInfo {
	hours: number;
	minutes: number;
}

// Task types
export interface TaskInfo {
	id?: string; // Task identifier (typically same as path for API consistency)
	title: string;
	status: string;
	due?: string;
	path: string;
	archived: boolean;
	tags?: string[];
	recurrence?: string; // RFC 5545 recurrence rule string
	recurrence_anchor?: 'due' | 'completion'; // Determines if recurrence is from due date (fixed) or completion date (flexible). Defaults to 'due'
	complete_instances?: string[]; // Array of dates (YYYY-MM-DD) when recurring task was completed
	skipped_instances?: string[]; // Array of dates (YYYY-MM-DD) when recurring task was skipped
	completedDate?: string; // Date (YYYY-MM-DD) when task was marked as done
	dateCreated?: string; // Creation date (ISO timestamp)
	dateModified?: string; // Last modification date (ISO timestamp)
	reminders?: Reminder[]; // Task reminders
	customProperties?: Record<string, any>; // Custom properties from Bases or other sources
	basesData?: any; // Raw Bases data for formula computation (internal use)
	details?: string; // Optional task body content
}

export interface TaskCreationData extends Partial<TaskInfo> {
	details?: string; // Optional details/description for file content
	parentNote?: string; // Optional parent note name/path for template variable
	creationContext?: "inline-conversion" | "manual-creation" | "modal-inline-creation" | "api" | "import"; // Context for folder determination
	customFrontmatter?: Record<string, any>; // Custom frontmatter properties (including user fields)
}

// Reminder types
export interface Reminder {
	id: string; // A unique ID for UI keying, e.g., 'rem_1678886400000'
	type: "absolute" | "relative";

	// For relative reminders
	relatedTo?: "due"; // The anchor date property
	offset?: string; // ISO 8601 duration format, e.g., "-PT5M", "-PT1H", "-P2D"

	// For absolute reminders
	absoluteTime?: string; // Full ISO 8601 timestamp, e.g., "2025-10-26T09:00:00"

	// Common properties
	description?: string; // The notification message (optional, can be auto-generated)
}

// Note types
export interface NoteInfo {
	title: string;
	tags: string[];
	path: string;
	createdDate?: string;
	lastModified?: number; // Timestamp of last modification
}

// File index types
export interface FileIndex {
	taskFiles: IndexedFile[];
	noteFiles: IndexedFile[];
	lastIndexed: number;
}

export interface IndexedFile {
	path: string;
	mtime: number;
	ctime: number;
	tags?: string[];
	isTask?: boolean;
	cachedInfo?: TaskInfo | NoteInfo;
}

// YAML Frontmatter types
export interface TaskFrontmatter {
	title: string;
	dateCreated: string;
	dateModified: string;
	status: "open" | "done";
	due?: string;
	tags: string[];
	recurrence?: string; // RFC 5545 recurrence rule string
	complete_instances?: string[];
	completedDate?: string;
}

export interface NoteFrontmatter {
	title: string;
	dateCreated: string;
	dateModified?: string;
	tags?: string[];
}

// Event handler types
export interface FileEventHandlers {
	modify?: (file: any) => void;
	delete?: (file: any) => void;
	rename?: (file: any, oldPath: string) => void;
	create?: (file: any) => void;
}

// Field mapping and customization types

/**
 * Property Naming Concepts
 *
 * The codebase uses three related but distinct property naming concepts:
 *
 * 1. FrontmatterPropertyName: The actual property name in YAML frontmatter
 *    Examples: "complete_instances", "due", "status", "my_custom_field"
 *    Source: FieldMapping values (e.g., mapping.completeInstances = "complete_instances")
 *
 * 2. FieldMappingKey: The key in the FieldMapping configuration object
 *    Examples: "completeInstances", "due", "status"
 *    Source: FieldMapping keys (keyof FieldMapping)
 *
 * 3. TaskCardPropertyId: The property identifier used by TaskCard extractors/renderers
 *    Examples: "complete_instances", "due"
 *    Notes: Usually matches FrontmatterPropertyName, but may differ for computed properties
 *           (e.g., computed display properties that don't map 1:1 to frontmatter)
 *
 * Key Insight: FieldMappingKey and FrontmatterPropertyName are often DIFFERENT
 * (e.g., key="completeInstances" -> value="complete_instances")
 * This distinction is critical for proper property mapping throughout the system.
 */

/** Property name as it appears in YAML frontmatter (e.g., "complete_instances", "due") */
export type FrontmatterPropertyName = string;

/** Key in the FieldMapping configuration object (e.g., "completeInstances", "due") */
export type FieldMappingKey = keyof FieldMapping;

/** Property identifier for TaskCard extractors/renderers (e.g., "complete_instances", "due") */
export type TaskCardPropertyId = string;

export interface FieldMapping {
	title: string;
	status: string;
	due: string;
	completedDate: string;
	dateCreated: string;
	dateModified: string;
	recurrence: string; // RFC 5545 recurrence rule string
	recurrenceAnchor: string; // User-configurable property name for recurrence_anchor field
	archiveTag: string; // For the archive tag in the tags array
	completeInstances: string;
	skippedInstances: string; // User-configurable property name for skipped instances
	reminders: string; // For task reminders
}

export interface StatusConfig {
	id: string; // Unique identifier
	value: string; // What gets written to YAML
	label: string; // What displays in UI
	color: string; // Hex color for UI elements
	icon?: string; // Optional Lucide icon name (e.g., "circle", "check", "clock")
	isCompleted: boolean; // Whether this counts as "done"
	order: number; // Sort order (for cycling)
	autoArchive: boolean; // Whether to auto-archive tasks with this status
	autoArchiveDelay: number; // Minutes to wait before auto-archiving
}

// Template configuration for quick setup
export interface Template {
	id: string;
	name: string;
	description: string;
	config: {
		fieldMapping: Partial<FieldMapping>;
		customStatuses: StatusConfig[];
	};
}

// Configuration export/import
export interface ExportedConfig {
	version: string;
	fieldMapping: FieldMapping;
	customStatuses: StatusConfig[];
}

// Kanban board types
export type KanbanGroupByField = "status";

export interface KanbanBoardConfig {
	id: string; // Unique ID
	name: string; // User-facing name
	groupByField: KanbanGroupByField; // What to group tasks by
	columnOrder: string[]; // Order of column values
}

// UI state management for filter preferences
export interface ViewFilterState {
	[viewType: string]: FilterQuery;
}

// All view-specific preferences
export interface ViewPreferences {
	[viewType: string]: any; // View-specific preferences
}

// Webhook types
export type WebhookEvent =
	| "task.created"
	| "task.updated"
	| "task.deleted"
	| "task.completed"
	| "task.archived"
	| "task.unarchived"
	| "recurring.instance.completed"
	| "recurring.instance.skipped"
	| "reminder.triggered";

export interface WebhookConfig {
	id: string;
	url: string;
	events: WebhookEvent[];
	secret: string;
	active: boolean;
	createdAt: string;
	lastTriggered?: string;
	failureCount: number;
	successCount: number;
	transformFile?: string; // Optional path to transformation file (.js or .json)
	corsHeaders?: boolean; // Whether to include custom headers (false for Discord, Slack, etc.)
}

export interface WebhookPayload {
	event: WebhookEvent;
	timestamp: string;
	vault: {
		name: string;
		path?: string;
	};
	data: any;
}

export interface WebhookDelivery {
	id: string;
	webhookId: string;
	event: WebhookEvent;
	payload: WebhookPayload;
	status: "pending" | "success" | "failed";
	attempts: number;
	lastAttempt?: string;
	responseStatus?: number;
	error?: string;
}

// Auto-archive types
export interface PendingAutoArchive {
	taskPath: string;
	statusChangeTimestamp: number;
	archiveAfterTimestamp: number;
	statusValue: string;
}

// Webhook notification interface for loose coupling
export interface IWebhookNotifier {
	triggerWebhook(event: WebhookEvent, data: any): Promise<void>;
}
