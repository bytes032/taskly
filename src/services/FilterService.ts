import {
	FilterQuery,
	TaskInfo,
	TaskGroupKey,
	FilterCondition,
	FilterGroup,
	FilterOptions,
	FilterProperty,
	FilterOperator,
} from "../types";
import { TaskManager } from "../utils/TaskManager";
import { StatusManager } from "./StatusManager";
import { EventEmitter } from "../utils/EventEmitter";
import {
	FilterUtils,
	FilterValidationError,
	FilterEvaluationError,
	TaskPropertyValue,
} from "../utils/FilterUtils";
import { getEffectiveTaskStatus, isDueByRRule } from "../utils/helpers";
import { format } from "date-fns";
import {
	isBeforeDateSafe,
	isSameDateSafe,
	startOfDayForDateString,
	getDatePart,
	parseDateToUTC,
} from "../utils/dateUtils";
import { FilterSortService } from "./filtering/FilterSortService";
import { FilterGroupingService } from "./filtering/FilterGroupingService";
import type TasklyPlugin from "../main";
import { normalizeUserListValue } from "./filtering/FilterUserFieldUtils";

/**
 * Unified filtering, sorting, and grouping service for all task views.
 * Provides performance-optimized data retrieval using CacheManager indexes.
 */
export class FilterService extends EventEmitter {
	private static lastInstance: FilterService | null = null;
	private cacheManager: TaskManager;
	private statusManager: StatusManager;

	// Query result caching for repeated filter operations
	private indexQueryCache = new Map<string, Set<string>>();
	private cacheTimeout = 30000; // 30 seconds
	private cacheTimers = new Map<string, ReturnType<typeof setTimeout>>();

	// Filter options caching for better performance
	private filterOptionsCache: FilterOptions | null = null;
	private filterOptionsCacheTimestamp = 0;
	private filterOptionsCacheTTL = 300000; // 5 minutes fallback TTL (should rarely be needed)
	private filterOptionsComputeCount = 0;
	private filterOptionsCacheHits = 0;

	private sortService: FilterSortService;
	private groupingService: FilterGroupingService;
	constructor(
		cacheManager: TaskManager,
		statusManager: StatusManager,
		private plugin?: TasklyPlugin
	) {
		super();
		this.cacheManager = cacheManager;
		this.statusManager = statusManager;
		this.sortService = new FilterSortService(cacheManager, statusManager, plugin);
		this.groupingService = new FilterGroupingService(cacheManager, statusManager, plugin);
		FilterService.lastInstance = this;
	}

	/**
	 * Main method to get filtered, sorted, and grouped tasks
	 * Handles the new advanced FilterQuery structure with nested conditions and groups
	 * Uses query-first approach with index optimization for better performance
	 */
	async getGroupedTasks(query: FilterQuery, targetDate?: Date): Promise<Map<string, TaskInfo[]>> {
		try {
			// Use non-strict validation to allow incomplete filters during building
			FilterUtils.validateFilterNode(query, false);

			// PHASE 1 OPTIMIZATION: Use query-first approach with index-backed filtering
			let candidateTaskPaths = this.getIndexOptimizedTaskPaths(query);

			// Convert paths to TaskInfo objects (only for candidates)
			const candidateTasks = await this.pathsToTaskInfos(Array.from(candidateTaskPaths));

			// Apply full filter query to the reduced candidate set
			const filteredTasks = candidateTasks.filter((task) =>
				this.evaluateFilterNode(query, task, targetDate)
			);

			// Sort the filtered results (flat sort)
			const sortedTasks = this.sortService.sortTasks(
				filteredTasks,
				query.sortKey || "due",
				query.sortDirection || "asc"
			);

			// Expose current sort to group ordering logic (used when groupKey === sortKey)
			this.groupingService.setSortContext(
				query.sortKey || "due",
				query.sortDirection || "asc"
			);

			// Group the results; group order handled inside sortGroups
			return this.groupingService.groupTasks(
				sortedTasks,
				query.groupKey || "none",
				targetDate
			);
		} catch (error) {
			if (error instanceof FilterValidationError || error instanceof FilterEvaluationError) {
				console.error("Filter error:", error.message, {
					nodeId: error.nodeId,
					field: (error as FilterValidationError).field,
				});
				// Return empty results rather than throwing - let UI handle gracefully
				return new Map<string, TaskInfo[]>();
			}
			throw error;
		}
	}

	/**
	 * Additive API: returns standard groups and optional hierarchicalGroups when subgroupKey is set
	 */
	async getHierarchicalGroupedTasks(
		query: FilterQuery,
		targetDate?: Date
	): Promise<{
		groups: Map<string, TaskInfo[]>;
		hierarchicalGroups?: Map<string, Map<string, TaskInfo[]>>;
	}> {
		try {
			// Allow incomplete filters while building
			FilterUtils.validateFilterNode(query, false);

			// Reuse the same pipeline as getGroupedTasks to avoid behavior drift
			let candidateTaskPaths = this.getIndexOptimizedTaskPaths(query);
			const candidateTasks = await this.pathsToTaskInfos(Array.from(candidateTaskPaths));
			const filteredTasks = candidateTasks.filter((task) =>
				this.evaluateFilterNode(query, task, targetDate)
			);

			const sortedTasks = this.sortService.sortTasks(
				filteredTasks,
				query.sortKey || "due",
				query.sortDirection || "asc"
			);

			// Preserve current sort for group ordering
			this.groupingService.setSortContext(
				query.sortKey || "due",
				query.sortDirection || "asc"
			);

			const groups = this.groupingService.groupTasks(
				sortedTasks,
				query.groupKey || "none",
				targetDate
			);

			// Compute hierarchical grouping only when both keys are active
			const subgroupKey = (query as any).subgroupKey as TaskGroupKey | undefined;
			if (
				subgroupKey &&
				subgroupKey !== "none" &&
				query.groupKey &&
				query.groupKey !== "none"
			) {
				// Lazy import to avoid circular deps at module load
				const { HierarchicalGroupingService } = await import(
					"./HierarchicalGroupingService"
				);

				// Resolver that mirrors user-field extraction logic used elsewhere in this service
				const resolver = (task: TaskInfo, fieldIdOrKey: string): string[] => {
					const userFields = this.plugin?.settings?.userFields || [];
					const field = userFields.find(
						(f: any) => (f.id || f.key) === fieldIdOrKey || f.key === fieldIdOrKey
					);
					const missingLabel = `No ${field?.displayName || field?.key || fieldIdOrKey}`;
					if (!field) return [missingLabel];
					try {
						const app = this.cacheManager.getApp();
						const file = app.vault.getAbstractFileByPath(task.path);
						if (!file) return [missingLabel];
						const fm = app.metadataCache.getFileCache(file as any)?.frontmatter;
						const raw = fm ? fm[field.key] : undefined;
						switch (field.type) {
							case "boolean": {
								if (typeof raw === "boolean") return [raw ? "true" : "false"];
								if (raw == null) return [missingLabel];
								const s = String(raw).trim().toLowerCase();
								if (s === "true" || s === "false") return [s];
								return [missingLabel];
							}
							case "number": {
								if (typeof raw === "number") return [String(raw)];
								if (typeof raw === "string") {
									const match = raw.match(/^(\d+(?:\.\d+)?)/);
									return match ? [match[1]] : [missingLabel];
								}
								return [missingLabel];
							}
							case "date": {
								return raw ? [String(raw)] : [missingLabel];
							}
							case "list": {
								// For grouping: use display tokens only (exclude raw wikilink tokens)
								const tokens = normalizeUserListValue(raw).filter(
									(t) => !/^\[\[/.test(t)
								);
								return tokens.length > 0 ? tokens : [missingLabel];
							}
							case "text":
							default: {
								const s = String(raw ?? "").trim();
								return s ? [s] : [missingLabel];
							}
						}
					} catch {
						return [missingLabel];
					}
				};

				const svc = new HierarchicalGroupingService(resolver);
				const hierarchicalGroups = svc.group(
					sortedTasks,
					query.groupKey as TaskGroupKey,
					subgroupKey,
					query.sortDirection || "asc",
					this.plugin?.settings?.userFields || []
				);

				// Ensure primary group order matches the same order used for flat groups
				// (e.g., status order) instead of insertion order influenced by the current task sort.
				const orderedPrimaryKeys = Array.from(groups.keys()); // already sorted via sortGroups()
				const orderedHierarchical = new Map<string, Map<string, TaskInfo[]>>();
				for (const key of orderedPrimaryKeys) {
					const sub = hierarchicalGroups.get(key);
					if (sub) orderedHierarchical.set(key, sub);
				}
				// Safety: include any primaries that might exist only in hierarchicalGroups
				for (const [key, sub] of hierarchicalGroups) {
					if (!orderedHierarchical.has(key)) orderedHierarchical.set(key, sub);
				}

				return { groups, hierarchicalGroups: orderedHierarchical };
			}

			return { groups };
		} catch (error) {
			if (error instanceof FilterValidationError || error instanceof FilterEvaluationError) {
				console.error("Filter error (hierarchical):", error.message, {
					nodeId: (error as any).nodeId,
				});
				return { groups: new Map<string, TaskInfo[]>() };
			}
			throw error;
		}
	}

	/**
	 * Get optimized task paths using index-backed filtering
	 * Analyzes the filter query to find safe optimization opportunities
	 * Returns a reduced set of candidate task paths for further processing
	 * CRITICAL: Only optimizes when it's guaranteed to not exclude valid results
	 */
	private getIndexOptimizedTaskPaths(query: FilterQuery): Set<string> {
		// Analyze if optimization is safe for this query structure
		const optimizationAnalysis = this.analyzeQueryOptimizationSafety(query);

		if (!optimizationAnalysis.canOptimize) {
			// Optimization not safe - return all task paths to ensure correctness
			return this.cacheManager.getAllTaskPaths();
		}

		// Safe to optimize - apply the optimization strategy
		if (optimizationAnalysis.strategy === "intersect") {
			// All indexable conditions are in AND relationship - intersect them
			let candidatePaths = this.getPathsForIndexableCondition(
				optimizationAnalysis.conditions[0]
			);

			for (let i = 1; i < optimizationAnalysis.conditions.length; i++) {
				const conditionPaths = this.getPathsForIndexableCondition(
					optimizationAnalysis.conditions[i]
				);
				candidatePaths = this.intersectPathSets(candidatePaths, conditionPaths);
			}

			return candidatePaths;
		} else if (optimizationAnalysis.strategy === "single") {
			// Single indexable condition that's safe to use
			const candidatePaths = this.getPathsForIndexableCondition(
				optimizationAnalysis.conditions[0]
			);
			return candidatePaths;
		}

		// Fallback to all tasks
		return this.cacheManager.getAllTaskPaths();
	}

	/**
	 * Analyze query structure to determine if optimization is safe and what strategy to use
	 */
	private analyzeQueryOptimizationSafety(query: FilterQuery): {
		canOptimize: boolean;
		strategy?: "intersect" | "single";
		conditions: FilterCondition[];
		reason?: string;
	} {
		// Find all indexable conditions in the query
		const indexableConditions = this.findIndexableConditions(query);

		if (indexableConditions.length === 0) {
			return {
				canOptimize: false,
				conditions: [],
				reason: "No indexable conditions found",
			};
		}

		// For simple queries (single condition or only AND at root level), optimization is safe
		if (this.isSimpleQuery(query, indexableConditions)) {
			return {
				canOptimize: true,
				strategy: indexableConditions.length === 1 ? "single" : "intersect",
				conditions: indexableConditions,
			};
		}

		// For complex queries with OR conditions involving indexable conditions,
		// we need to be very careful. Conservative approach: don't optimize.
		return {
			canOptimize: false,
			conditions: indexableConditions,
			reason: "Complex query structure with OR conditions - optimization not safe",
		};
	}

	/**
	 * Check if query is simple enough for safe optimization
	 * A simple query is one where all indexable conditions are in AND relationship
	 */
	private isSimpleQuery(query: FilterQuery, indexableConditions: FilterCondition[]): boolean {
		// If no indexable conditions, nothing to optimize
		if (indexableConditions.length === 0) {
			return false;
		}

		// CRITICAL: Check if any indexable condition is part of an OR group
		// This would make pre-filtering unsafe as it could exclude valid results
		if (this.hasIndexableConditionInOrGroup(query, indexableConditions)) {
			return false;
		}

		// If only one indexable condition AND it's not in an OR group, safe to optimize
		if (indexableConditions.length === 1) {
			return true;
		}

		// Check if all indexable conditions are at the root level and root is AND
		if (query.type === "group" && query.conjunction === "and") {
			const rootIndexableConditions = query.children.filter(
				(child) => child.type === "condition" && this.isIndexableCondition(child)
			);

			// If all indexable conditions are at root level in an AND group, safe to intersect
			if (rootIndexableConditions.length === indexableConditions.length) {
				return true;
			}
		}

		// Any other structure is potentially unsafe
		return false;
	}

	/**
	 * Check if any indexable condition is part of an OR group
	 * This makes optimization unsafe as it would exclude valid results
	 */
	private hasIndexableConditionInOrGroup(
		query: FilterQuery,
		indexableConditions: FilterCondition[]
	): boolean {
		return this.checkNodeForOrWithIndexable(query, indexableConditions);
	}

	/**
	 * Recursively check if any indexable condition is in an OR group
	 */
	private checkNodeForOrWithIndexable(
		node: FilterQuery | FilterCondition,
		indexableConditions: FilterCondition[]
	): boolean {
		if (node.type === "condition") {
			return false; // Conditions themselves can't contain OR
		}

		if (node.type === "group") {
			// If this group is OR and contains any indexable conditions, optimization is unsafe
			if (node.conjunction === "or") {
				const hasIndexableChild = node.children.some(
					(child) => child.type === "condition" && indexableConditions.includes(child)
				);
				if (hasIndexableChild) {
					return true;
				}
			}

			// Recursively check child groups
			for (const child of node.children) {
				if (this.checkNodeForOrWithIndexable(child, indexableConditions)) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Recursively find all indexable conditions in a filter query
	 */
	private findIndexableConditions(node: FilterQuery | FilterCondition): FilterCondition[] {
		const conditions: FilterCondition[] = [];

		if (node.type === "condition") {
			if (this.isIndexableCondition(node)) {
				conditions.push(node);
			}
		} else if (node.type === "group") {
			for (const child of node.children) {
				conditions.push(...this.findIndexableConditions(child));
			}
		}

		return conditions;
	}

	/**
	 * Check if a condition can be optimized using existing indexes
	 */
	private isIndexableCondition(condition: FilterCondition): boolean {
		const { property, operator, value } = condition;

		// Status-based conditions (uses tasksByStatus index)
		if (property === "status" && operator === "is" && value) {
			return true;
		}

		// Due date conditions (uses tasksByDate index)
		if (
			property === "due" &&
			(operator === "is" || operator === "is-before" || operator === "is-after") &&
			value
		) {
			return true;
		}

		return false;
	}

	/**
	 * Get cached index query result with automatic expiration
	 * Returns a copy of the cached result to avoid mutation issues
	 */
	private getCachedIndexResult(cacheKey: string, computer: () => Set<string>): Set<string> {
		const cached = this.indexQueryCache.get(cacheKey);
		if (cached) {
			// Cache hit - return copy to avoid mutation of cached data
			return new Set(cached);
		}

		// Cache miss - compute the result
		const result = computer();

		// Cache the result
		this.indexQueryCache.set(cacheKey, new Set(result));

		// Clear any existing timer for this key
		const existingTimer = this.cacheTimers.get(cacheKey);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Auto-expire cache entry after timeout
		const timer = setTimeout(() => {
			this.indexQueryCache.delete(cacheKey);
			this.cacheTimers.delete(cacheKey);
		}, this.cacheTimeout);

		this.cacheTimers.set(cacheKey, timer);

		return result;
	}

	/**
	 * Clear all cached index query results
	 * Called when underlying data changes to ensure cache consistency
	 */
	private clearIndexQueryCache(): void {
		// Clear all timers
		for (const timer of this.cacheTimers.values()) {
			clearTimeout(timer);
		}

		// Clear caches
		this.indexQueryCache.clear();
		this.cacheTimers.clear();
	}

	/**
	 * Get query cache statistics for monitoring performance
	 */
	getCacheStats(): {
		entryCount: number;
		cacheKeys: string[];
		timeoutMs: number;
	} {
		return {
			entryCount: this.indexQueryCache.size,
			cacheKeys: Array.from(this.indexQueryCache.keys()),
			timeoutMs: this.cacheTimeout,
		};
	}

	/**
	 * Get task paths for a specific indexable condition with caching
	 */
	private getPathsForIndexableCondition(condition: FilterCondition): Set<string> {
		const { property, operator, value } = condition;

		// Create cache key from condition properties
		const cacheKey = `${property}:${operator}:${value}`;

		return this.getCachedIndexResult(cacheKey, () => {
			// Original logic for computing paths
			if (property === "status" && operator === "is" && value && typeof value === "string") {
				return new Set(this.cacheManager.getTaskPathsByStatus(value));
			}

			if (property === "due" && operator === "is" && value && typeof value === "string") {
				return new Set(this.cacheManager.getTasksForDate(value));
			}

			// For date range conditions, we'll need to implement range queries
			if (
				property === "due" &&
				(operator === "is-before" || operator === "is-after") &&
				value &&
				typeof value === "string"
			) {
				return this.getTaskPathsForDateRange(property, operator, value);
			}

			// Fallback - return all paths if we can't optimize
			return this.cacheManager.getAllTaskPaths();
		});
	}

	/**
	 * Get task paths for date range queries (before/after operators)
	 */
	private getTaskPathsForDateRange(
		property: string,
		operator: string,
		value: string
	): Set<string> {
		// For now, return all paths and let the full filter handle the range logic
		// This could be optimized further by implementing date range indexes
		return this.cacheManager.getAllTaskPaths();
	}

	/**
	 * Intersect two sets of task paths
	 */
	private intersectPathSets(set1: Set<string>, set2: Set<string>): Set<string> {
		const intersection = new Set<string>();
		for (const path of set1) {
			if (set2.has(path)) {
				intersection.add(path);
			}
		}
		return intersection;
	}

	/**
	 * Convert task paths to TaskInfo objects
	 */
	private async pathsToTaskInfos(paths: string[]): Promise<TaskInfo[]> {
		const tasks: TaskInfo[] = [];
		const batchSize = 50;

		for (let i = 0; i < paths.length; i += batchSize) {
			const batch = paths.slice(i, i + batchSize);
			const batchTasks = await Promise.all(
				batch.map((path) => this.cacheManager.getCachedTaskInfo(path))
			);

			for (const task of batchTasks) {
				if (task) {
					tasks.push(task);
				}
			}
		}

		return tasks;
	}

	/**
	 * Recursively evaluate a filter node (group or condition) against a task
	 * Returns true if the task matches the filter criteria
	 */
	private evaluateFilterNode(
		node: FilterGroup | FilterCondition,
		task: TaskInfo,
		targetDate?: Date
	): boolean {
		if (node.type === "condition") {
			return this.evaluateCondition(node, task, targetDate);
		} else if (node.type === "group") {
			return this.evaluateGroup(node, task, targetDate);
		}
		return true; // Default to true if unknown node type
	}

	/**
	 * Evaluate a filter group against a task
	 */
	private evaluateGroup(group: FilterGroup, task: TaskInfo, targetDate?: Date): boolean {
		if (group.children.length === 0) {
			return true; // Empty group matches everything
		}

		// Filter out incomplete conditions - they should be completely ignored
		const completeChildren = group.children.filter((child) => {
			if (child.type === "condition") {
				return FilterUtils.isFilterNodeComplete(child);
			}
			return true; // Groups are always evaluated (they may contain complete conditions)
		});

		// If no complete children, return true (no active filters)
		if (completeChildren.length === 0) {
			return true;
		}

		if (group.conjunction === "and") {
			// All complete children must match
			return completeChildren.every((child) =>
				this.evaluateFilterNode(child, task, targetDate)
			);
		} else if (group.conjunction === "or") {
			// At least one complete child must match
			return completeChildren.some((child) =>
				this.evaluateFilterNode(child, task, targetDate)
			);
		}

		return true; // Default to true if unknown conjunction
	}

	/**
	 * Evaluate a single filter condition against a task
	 */
	private evaluateCondition(
		condition: FilterCondition,
		task: TaskInfo,
		targetDate?: Date
	): boolean {
		const { property, operator, value } = condition;

		// Dynamic user-mapped properties: user:<id>
		if (typeof property === "string" && property.startsWith("user:")) {
			const fieldId = property.slice(5);
			const userFields = this.plugin?.settings?.userFields || [];
			const field = userFields.find((f: any) => (f.id || f.key) === fieldId);
			let taskValue: TaskPropertyValue = undefined;
			if (field) {
				try {
					const app = this.cacheManager.getApp();
					const file = app.vault.getAbstractFileByPath(task.path);
					if (file) {
						const fm = app.metadataCache.getFileCache(file as any)?.frontmatter;
						const raw = fm ? fm[field.key] : undefined;
						// Normalize based on type
						switch (field.type) {
							case "boolean":
								taskValue =
									typeof raw === "boolean"
										? raw
										: String(raw).toLowerCase() === "true";
								break;
							case "number":
								taskValue =
									typeof raw === "number"
										? raw
										: raw != null
											? parseFloat(String(raw))
											: undefined;
								break;
							case "list":
								taskValue = normalizeUserListValue(raw);
								break;
							default:
								taskValue = raw != null ? String(raw) : undefined;
						}
					}
				} catch {
					// Ignore JSON parsing errors for malformed user field values
				}
			}
			// For list user fields, treat 'contains' as substring match across tokens
			if (
				field?.type === "list" &&
				(operator === "contains" || operator === "does-not-contain")
			) {
				const haystack = Array.isArray(taskValue)
					? (taskValue as string[])
					: taskValue != null
						? [String(taskValue)]
						: [];
				const needles = Array.isArray(value) ? (value as string[]) : [String(value ?? "")];
				const match = needles.some(
					(n) =>
						typeof n === "string" &&
						haystack.some(
							(h) =>
								typeof h === "string" && h.toLowerCase().includes(n.toLowerCase())
						)
				);
				return operator === "contains" ? match : !match;
			}

			// For date equality, trick date handling by passing a known date property id
			const propForDate =
				field?.type === "date" ? ("due" as FilterProperty) : (property as FilterProperty);
			return FilterUtils.applyOperator(
				taskValue,
				operator as FilterOperator,
				value,
				condition.id,
				propForDate
			);
		}

		// Get the actual value from the task
		let taskValue: TaskPropertyValue = FilterUtils.getTaskPropertyValue(
			task,
			property as FilterProperty
		);

		// Handle special case for status.isCompleted
		if (property === "status.isCompleted") {
			const effectiveStatus = getEffectiveTaskStatus(task, targetDate || new Date());
			taskValue = this.statusManager.isCompletedStatus(effectiveStatus);
		}

		// Handle status as boolean (is task completed?)
		if (property === "status") {
			const effectiveStatus = getEffectiveTaskStatus(task, targetDate || new Date());
			taskValue = this.statusManager.isCompletedStatus(effectiveStatus);
		}

		// Apply the operator
		return FilterUtils.applyOperator(
			taskValue,
			operator as FilterOperator,
			value,
			condition.id,
			property as FilterProperty
		);
	}

	/**
	 * Get task paths within a date range
	 */
	private async getTaskPathsInDateRange(
		startDate: string,
		endDate: string
	): Promise<Set<string>> {
		const pathsInRange = new Set<string>();
		// Use UTC anchors for consistent date range operations
		const start = parseDateToUTC(startDate);
		const end = parseDateToUTC(endDate);

		// Get tasks with due dates in the range (existing logic)
		for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
			const dateStr = format(date, "yyyy-MM-dd"); // CORRECT: Uses local timezone
			const pathsForDate = this.cacheManager.getTaskPathsByDate(dateStr);
			pathsForDate.forEach((path) => pathsInRange.add(path));
		}

		// Also check recurring tasks without due dates to see if they should appear in this range
		const allTaskPaths = this.cacheManager.getAllTaskPaths();

		// Process paths in batches for better performance
		const batchSize = 50;
		const pathArray = Array.from(allTaskPaths);

		for (let i = 0; i < pathArray.length; i += batchSize) {
			const batch = pathArray.slice(i, i + batchSize);
			const batchTasks = await Promise.all(
				batch.map((path) => this.cacheManager.getCachedTaskInfo(path))
			);

			for (const task of batchTasks) {
				if (task && task.recurrence && !task.due) {
					// Check if this recurring task should appear on any date in the range
					for (
						let date = new Date(start);
						date <= end;
						date.setDate(date.getDate() + 1)
					) {
						if (isDueByRRule(task, date)) {
							pathsInRange.add(task.path);
							break; // No need to check more dates once we find a match
						}
					}
				}
			}
		}

		return pathsInRange;
	}

	/**
	 * Get overdue task paths efficiently using the dedicated index
	 */
	getOverdueTaskPaths(): Set<string> {
		return this.cacheManager.getOverdueTaskPaths();
	}

	/**
	 * Combine multiple task path sets (e.g., date range + overdue)
	 */
	private combineTaskPathSets(sets: Set<string>[]): Set<string> {
		const combined = new Set<string>();
		sets.forEach((set) => {
			set.forEach((path) => combined.add(path));
		});
		return combined;
	}

	/**
	 * Check if a date string falls within a date range (inclusive)
	 * Works with both date-only and datetime strings
	 */
	private isDateInRange(
		dateString: string,
		startDateString: string,
		endDateString: string
	): boolean {
		try {
			// Extract date parts for range comparison
			const datePart = getDatePart(dateString);
			const startDatePart = getDatePart(startDateString);
			const endDatePart = getDatePart(endDateString);

			const date = startOfDayForDateString(datePart);
			const startDate = startOfDayForDateString(startDatePart);
			const endDate = startOfDayForDateString(endDatePart);

			return date >= startDate && date <= endDate;
		} catch (error) {
			console.error("Error checking date range:", {
				dateString,
				startDateString,
				endDateString,
				error,
			});
			return false;
		}
	}

	/**
	 * Check if a Date object represents the same day as a date string
	 */
	private isSameDayAs(dateObj: Date, dateString: string): boolean {
		try {
			// Use safe date comparison with UTC anchors
			const dateObjString = format(dateObj, "yyyy-MM-dd");
			return isSameDateSafe(dateObjString, dateString);
		} catch (error) {
			console.error("Error comparing date object with date string:", {
				dateObj,
				dateString,
				error,
			});
			return false;
		}
	}

	/**
	 * Get available filter options for building filter UI
	 * Uses event-driven caching - cache is invalidated only when new options are detected
	 */
	async getFilterOptions(): Promise<FilterOptions> {
		const now = Date.now();

		// Return cached options if valid and not expired by fallback TTL
		if (
			this.filterOptionsCache &&
			now - this.filterOptionsCacheTimestamp < this.filterOptionsCacheTTL
		) {
			this.filterOptionsCacheHits++;
			return this.filterOptionsCache;
		}

		// Cache miss - compute fresh options

		const freshOptions = {
			statuses: this.statusManager.getAllStatuses(),
			tags: this.cacheManager.getAllTags(),
			folders: this.extractUniqueFolders(),
			userProperties: this.buildUserPropertyDefinitions(),
		};

		this.filterOptionsComputeCount++;

		// Update cache and timestamp
		this.filterOptionsCache = freshOptions;
		this.filterOptionsCacheTimestamp = now;

		return freshOptions;
	}

	/**
	 * Build dynamic user property definitions from settings.userFields
	 */
	private buildUserPropertyDefinitions(): import("../types").PropertyDefinition[] {
		const fields = this.plugin?.settings?.userFields || [];
		const defs: import("../types").PropertyDefinition[] = [];
		for (const f of fields) {
			if (!f || !f.key || !f.displayName) continue;
			const id = `user:${f.id || f.key}` as import("../types").FilterProperty;
			// Map type to supported operators and value input type
			let supported: import("../types").FilterOperator[];
			let valueInputType: import("../types").PropertyDefinition["valueInputType"];
			switch (f.type) {
				case "number":
					supported = [
						"is",
						"is-not",
						"is-greater-than",
						"is-less-than",
						"is-greater-than-or-equal",
						"is-less-than-or-equal",
						"is-empty",
						"is-not-empty",
					];
					valueInputType = "number";
					break;
				case "date":
					supported = [
						"is",
						"is-not",
						"is-before",
						"is-after",
						"is-on-or-before",
						"is-on-or-after",
						"is-empty",
						"is-not-empty",
					];
					valueInputType = "date";
					break;
				case "boolean":
					supported = ["is-checked", "is-not-checked"];
					valueInputType = "none";
					break;
				case "list":
					supported = ["contains", "does-not-contain", "is-empty", "is-not-empty"];
					valueInputType = "text";
					break;
				case "text":
				default:
					supported = [
						"is",
						"is-not",
						"contains",
						"does-not-contain",
						"is-empty",
						"is-not-empty",
					];
					valueInputType = "text";
					break;
			}
			defs.push({
				id,
				label: f.displayName,
				category:
					f.type === "boolean"
						? "boolean"
						: f.type === "number"
							? "numeric"
							: f.type === "date"
								? "date"
								: "text",
				supportedOperators: supported,
				valueInputType,
			});
		}
		return defs;
	}

	/**
	 * Check if new filter options have been detected and invalidate cache if needed
	 * Uses a time-based throttling approach to balance freshness with performance
	 */
	private checkAndInvalidateFilterOptionsCache(): void {
		if (!this.filterOptionsCache) {
			return; // No cache to invalidate
		}

		const now = Date.now();
		const cacheAge = now - this.filterOptionsCacheTimestamp;

		// Use a smart invalidation strategy:
		// 1. If cache is very fresh (< 30 seconds), keep it (most changes don't affect options)
		// 2. If cache is older, invalidate it to ensure new options are picked up
		// This gives us good performance for rapid file changes while ensuring freshness
		const minCacheAge = 30000; // 30 seconds

		if (cacheAge > minCacheAge) {
			this.invalidateFilterOptionsCache();
		}
	}

	/**
	 * Manually invalidate the filter options cache
	 */
	private invalidateFilterOptionsCache(): void {
		if (this.filterOptionsCache) {
			this.filterOptionsCache = null;
		}
	}

	/**
	 * Force refresh of filter options cache
	 * This can be called by UI components when they detect stale data
	 */
	refreshFilterOptions(): void {
		this.invalidateFilterOptionsCache();
	}

	/**
	 * Get performance statistics for filter options caching
	 */
	getFilterOptionsCacheStats(): {
		cacheHits: number;
		computeCount: number;
		hitRate: string;
		isCurrentlyCached: boolean;
		cacheAge: number;
		ttlRemaining: number;
	} {
		const now = Date.now();
		const cacheAge = this.filterOptionsCache ? now - this.filterOptionsCacheTimestamp : 0;
		const ttlRemaining = this.filterOptionsCache
			? Math.max(0, this.filterOptionsCacheTTL - cacheAge)
			: 0;
		const totalRequests = this.filterOptionsCacheHits + this.filterOptionsComputeCount;
		const hitRate =
			totalRequests > 0
				? ((this.filterOptionsCacheHits / totalRequests) * 100).toFixed(1) + "%"
				: "0%";

		return {
			cacheHits: this.filterOptionsCacheHits,
			computeCount: this.filterOptionsComputeCount,
			hitRate,
			isCurrentlyCached: !!this.filterOptionsCache,
			cacheAge,
			ttlRemaining,
		};
	}

	/**
	 * Create a default filter query with the new structure
	 */
	createDefaultQuery(): FilterQuery {
		return {
			type: "group",
			id: FilterUtils.generateId(),
			conjunction: "and",
			children: [],
			sortKey: "due",
			sortDirection: "asc",
			groupKey: "none",
		};
	}

	/**
	 * Add quick toggle conditions (Show Completed, Show Archived, Hide Recurring)
	 * These are syntactic sugar that programmatically modify the root query
	 */
	addQuickToggleCondition(
		query: FilterQuery,
		toggle: "showCompleted" | "showArchived" | "showRecurrent",
		enabled: boolean
	): FilterQuery {
		const newQuery = JSON.parse(JSON.stringify(query)); // Deep clone

		// Remove existing condition for this toggle if it exists
		this.removeQuickToggleCondition(newQuery, toggle);

		// Add new condition if toggle is disabled (meaning we want to filter out)
		if (!enabled) {
			let condition: FilterCondition;

			switch (toggle) {
				case "showCompleted":
					condition = {
						type: "condition",
						id: FilterUtils.generateId(),
						property: "status.isCompleted",
						operator: "is-not-checked",
						value: null,
					};
					break;
				case "showArchived":
					condition = {
						type: "condition",
						id: FilterUtils.generateId(),
						property: "archived",
						operator: "is-not-checked",
						value: null,
					};
					break;
				case "showRecurrent":
					condition = {
						type: "condition",
						id: FilterUtils.generateId(),
						property: "recurrence",
						operator: "is-empty",
						value: null,
					};
					break;
			}

			newQuery.children.push(condition);
		}

		return newQuery;
	}

	/**
	 * Remove quick toggle condition from query
	 */
	private removeQuickToggleCondition(
		query: FilterQuery,
		toggle: "showCompleted" | "showArchived" | "showRecurrent"
	): void {
		let propertyToRemove: string;

		switch (toggle) {
			case "showCompleted":
				propertyToRemove = "status.isCompleted";
				break;
			case "showArchived":
				propertyToRemove = "archived";
				break;
			case "showRecurrent":
				propertyToRemove = "recurrence";
				break;
		}

		query.children = query.children.filter((child) => {
			if (child.type === "condition") {
				return child.property !== propertyToRemove;
			}
			return true;
		});
	}

	/**
	 * Validate and normalize a filter query
	 */
	normalizeQuery(query: Partial<FilterQuery>): FilterQuery {
		const defaultQuery = this.createDefaultQuery();

		return {
			...defaultQuery,
			...query,
			type: "group",
			id: query.id || defaultQuery.id,
			conjunction: query.conjunction || defaultQuery.conjunction,
			children: query.children || defaultQuery.children,
			sortKey: query.sortKey || defaultQuery.sortKey,
			sortDirection: query.sortDirection || defaultQuery.sortDirection,
			groupKey: query.groupKey || defaultQuery.groupKey,
		};
	}

	/**
	 * Subscribe to cache changes and emit refresh events
	 */
	initialize(): void {
		this.cacheManager.on("file-updated", () => {
			this.clearIndexQueryCache();
			this.checkAndInvalidateFilterOptionsCache();
			this.emit("data-changed");
		});

		this.cacheManager.on("file-added", () => {
			this.clearIndexQueryCache();
			this.checkAndInvalidateFilterOptionsCache();
			this.emit("data-changed");
		});

		this.cacheManager.on("file-deleted", () => {
			this.clearIndexQueryCache();
			this.checkAndInvalidateFilterOptionsCache();
			this.emit("data-changed");
		});

		this.cacheManager.on("file-renamed", () => {
			this.clearIndexQueryCache();
			this.checkAndInvalidateFilterOptionsCache();
			this.emit("data-changed");
		});

		this.cacheManager.on("indexes-built", () => {
			this.clearIndexQueryCache();
			this.checkAndInvalidateFilterOptionsCache();
			this.emit("data-changed");
		});
	}

	/**
	 * Clean up event subscriptions and clear any caches
	 */
	cleanup(): void {
		// Clear query result cache and timers
		this.clearIndexQueryCache();

		// Clear filter options cache
		this.invalidateFilterOptionsCache();

		// Remove all event listeners
		this.removeAllListeners();
	}

	/**
	 * Extract unique folder paths from all task paths
	 * Returns an array of folder paths for dropdown filtering
	 */
	private extractUniqueFolders(): readonly string[] {
		const allTaskPaths = this.cacheManager.getAllTaskPaths();
		const folderSet = new Set<string>();

		for (const taskPath of allTaskPaths) {
			// Extract the folder part of the path (everything before the last slash)
			const lastSlashIndex = taskPath.lastIndexOf("/");
			if (lastSlashIndex > 0) {
				const folderPath = taskPath.substring(0, lastSlashIndex);
				folderSet.add(folderPath);
			}
			// Also add root-level folder (empty string or "." for tasks in vault root)
			else if (lastSlashIndex === -1) {
				folderSet.add(""); // Root folder
			}
		}

		// Convert to sorted array for consistent UI ordering
		const folders = Array.from(folderSet).sort();

		// Replace empty string with a user-friendly label for root folder
		const rootLabel = "(Root)";
		return folders.map((folder) => (folder === "" ? rootLabel : folder));
	}

}
