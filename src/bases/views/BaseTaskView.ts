/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Notice, TFile, setIcon } from "obsidian";
import TasklyPlugin from "../../main";
import { BasesViewBase } from "../BasesViewBase";
import { TaskInfo } from "../../types";
import { BasesDataItem } from "../helpers";
import { createTaskCard, showTaskContextMenu } from "../../ui/TaskCard";
import { renderGroupTitle } from "../groupTitleRenderer";
import { type LinkServices } from "../../ui/renderers/linkRenderer";
import { DateContextMenu } from "../../components/DateContextMenu";
import { RecurrenceContextMenu } from "../../components/RecurrenceContextMenu";
import { ReminderModal } from "../../modals/ReminderModal";
import { getDatePart, getTimePart, parseDateToUTC, createUTCDateFromLocalCalendarDate } from "../../utils/dateUtils";
import { VirtualScroller } from "../../utils/VirtualScroller";
import { TaskListCacheManager, TaskListCacheContext } from "../taskList/TaskListCacheManager";

export class BaseTaskView extends BasesViewBase {
	type = "tasklyBase";

	private itemsContainer: HTMLElement | null = null;
	private currentTaskElements = new Map<string, HTMLElement>();
	private lastRenderWasGrouped = false;
	private lastFlatPaths: string[] = [];
	private lastTaskSignatures = new Map<string, string>();
	private taskInfoCache = new Map<string, TaskInfo>();
	private clickTimeouts = new Map<string, number>();
	private currentTargetDate = createUTCDateFromLocalCalendarDate(new Date());
	private containerListenersRegistered = false;
	private virtualScroller: VirtualScroller<any> | null = null; // Can render TaskInfo or group headers
	private useVirtualScrolling = false;
	private collapsedGroups = new Set<string>(); // Track collapsed group keys
	private collapsedSubGroups = new Set<string>(); // Track collapsed sub-group keys
	private subGroupPropertyId: string | null = null; // Property ID for sub-grouping
	private configLoaded = false; // Track if we've successfully loaded config
	protected useTableLayout = false; // Enable table layout with columns
	protected showTableHeader = true; // Show column headers in table layout
	private cacheManager: TaskListCacheManager;
	private fileUpdateListener: any = null;

	/**
	 * Threshold for enabling virtual scrolling in task list view.
	 * Virtual scrolling activates when total items (tasks + group headers) >= 100.
	 * Benefits: ~90% memory reduction, eliminates UI lag for large lists.
	 * Lower threshold because task cards are simpler/smaller.
	 */
	private readonly VIRTUAL_SCROLL_THRESHOLD = 100;

	constructor(controller: any, containerEl: HTMLElement, plugin: TasklyPlugin) {
		super(controller, containerEl, plugin);
		// BasesView now provides this.data, this.config, and this.app directly
		// Update the data adapter to use this BasesView instance
		(this.dataAdapter as any).basesView = this;
		this.cacheManager = new TaskListCacheManager(plugin);
	}

	/**
	 * Component lifecycle: Called when view is first loaded.
	 * Override from Component base class.
	 */
	onload(): void {
		// Read view options now that config is available
		this.readViewOptions();
		// Call parent onload which sets up container and listeners
		super.onload();
	}

	protected setupTaskUpdateListener(): void {
		super.setupTaskUpdateListener();

		if (this.fileUpdateListener) return;

		this.fileUpdateListener = this.plugin.emitter.on(
			"file-updated",
			async (eventData: any) => {
				try {
					const taskPath = eventData?.path;
					if (!taskPath) return;

					// Skip if view is not visible
					if (!this.rootElement?.isConnected) return;

					// Only handle files that are part of this view
					if (!this.relevantPathsCache.has(taskPath)) return;

					const updatedTask = await this.plugin.cacheManager.getTaskInfo(taskPath);
					if (updatedTask) {
						await this.handleTaskUpdate(updatedTask);
					} else {
						this.debouncedRefresh();
					}
				} catch (error) {
					console.error("[Taskly][Bases] Error handling file update:", error);
					this.debouncedRefresh();
				}
			}
		);

		this.register(() => {
			if (this.fileUpdateListener) {
				this.plugin.emitter.offref(this.fileUpdateListener);
				this.fileUpdateListener = null;
			}
		});
	}

	/**
	 * Read view configuration options from BasesViewConfig.
	 */
	private readViewOptions(): void {
		// Guard: config may not be set yet if called too early
		if (!this.config || typeof this.config.get !== 'function') {
			console.debug('[BaseTaskView] Config not available yet in readViewOptions');
			return;
		}

		try {
			this.subGroupPropertyId = this.config.getAsPropertyId('subGroup');
			// Read enableSearch toggle (default: false for backward compatibility)
			const enableSearchValue = this.config.get('enableSearch');
			this.enableSearch = (enableSearchValue as boolean) ?? false;
			// Read showTableHeader toggle (default: true when table layout is enabled)
			const showHeaderValue = this.config.get('showTableHeader');
			this.showTableHeader = (showHeaderValue as boolean) ?? true;
			// Mark config as successfully loaded
			this.configLoaded = true;
		} catch (e) {
			// Use defaults
			console.warn('[BaseTaskView] Failed to parse config:', e);
		}
	}

	private getCacheContext(): TaskListCacheContext {
		return {
			data: this.data,
			config: this.config,
			dataAdapter: this.dataAdapter,
			type: this.type,
			useTableLayout: this.useTableLayout,
			showTableHeader: this.showTableHeader,
			subGroupPropertyId: this.subGroupPropertyId,
			currentSearchTerm: this.currentSearchTerm,
		};
	}

	protected setupContainer(): void {
		super.setupContainer();

		// Make rootElement fill its container and establish flex context
		if (this.rootElement) {
			this.rootElement.style.cssText = "display: flex; flex-direction: column; height: 100%;";
		}

		// Use correct document for pop-out window support
		const doc = this.containerEl.ownerDocument;

		// Create items container
		const itemsContainer = doc.createElement("div");
		itemsContainer.className = "tn-bases-items-container";
		// Use flex: 1 to fill available space in the rootElement flex container
		// max-height: 100vh prevents unbounded growth when embedded in notes
		// overflow-y: auto provides scrolling when content exceeds available height
		itemsContainer.style.cssText = "margin-top: 12px; flex: 1; max-height: 100vh; overflow-y: auto; position: relative;";
		this.rootElement?.appendChild(itemsContainer);
		this.itemsContainer = itemsContainer;
		this.registerContainerListeners();
	}

	async render(): Promise<void> {
		if (!this.itemsContainer || !this.rootElement) return;

		const renderStart = performance.now();
		const timings: Record<string, number> = {};

		// Ensure view options are read (in case config wasn't available in onload)
		if (!this.configLoaded && this.config) {
			this.readViewOptions();
		}

		// Now that config is loaded, setup search (idempotent: will only create once)
		if (this.rootElement) {
			this.setupSearch(this.rootElement);
		}

		try {
			// Skip rendering if we have no data yet (prevents flickering during data updates)
			if (!this.data?.data) {
				const renderedFromCache = await this.renderStaleTableFromCache();
				if (renderedFromCache) {
					return;
				}
				return;
			}

			// Extract data using adapter (adapter now uses this as basesView)
			let t0 = performance.now();
			const dataItems = this.dataAdapter.extractDataItems();
			timings['extractDataItems'] = performance.now() - t0;

			// Resolve visible properties once (used for formula detection + rendering)
			t0 = performance.now();
			const visibleProperties = this.getVisibleProperties();
			timings['getVisibleProperties'] = performance.now() - t0;

			const isGrouped = this.dataAdapter.isGrouped();
			const visiblePropertiesKey = visibleProperties.join(",");
			const groupKey = `${isGrouped ? "grouped" : "flat"}|${this.subGroupPropertyId ?? ""}`;
			const dataFingerprint = this.cacheManager.buildDataFingerprint(dataItems);
			const renderSnapshot = this.cacheManager.getRenderSnapshot(
				this.useTableLayout,
				this.showTableHeader,
				this.currentSearchTerm,
				visiblePropertiesKey
			);

			const shouldSkipRender = this.cacheManager.shouldSkipRender(
				dataFingerprint,
				groupKey,
				renderSnapshot,
				!!this.itemsContainer?.childElementCount
			);

			if (shouldSkipRender) {
				this.cacheManager.logRevalidatedIfNeeded();
				return;
			}

			// Compute formulas only when needed (visible formula columns or sub-grouping on formula)
			const neededFormulaNames = this.getNeededFormulaNames(
				visibleProperties,
				this.subGroupPropertyId
			);
			if (neededFormulaNames.size > 0) {
				t0 = performance.now();
				await this.computeFormulas(dataItems, neededFormulaNames);
				timings['computeFormulas'] = performance.now() - t0;
			}

			t0 = performance.now();
			const taskItems = this.cacheManager.identifyTasklyMemoized(dataItems);
			timings['identifyTaskly'] = performance.now() - t0;

			// Build property map once for sub-grouping (avoid re-extracting data)
			t0 = performance.now();
			const pathToProps = this.subGroupPropertyId
				? this.buildPathToPropsMapFromDataItems(
						dataItems,
						neededFormulaNames.size > 0
				  )
				: null;
			if (this.subGroupPropertyId) {
				timings['buildPathToPropsMap'] = performance.now() - t0;
			}

			if (taskItems.length === 0) {
				this.clearAllTaskElements();
				this.renderEmptyState();
				this.lastRenderWasGrouped = false;
				this.cacheManager.updateLastRenderedTaskVersions([], renderSnapshot);
				this.cacheManager.recordRenderState(dataFingerprint, groupKey, renderSnapshot);
				this.cacheManager.updateTableSWRCache(
					this.getCacheContext(),
					taskItems,
					visibleProperties,
					isGrouped,
					!!this.subGroupPropertyId,
					this.snapshotTasksForTable.bind(this)
				);
				return;
			}

			// Special case: if sub-grouping is configured but primary grouping is not,
			// treat sub-group property as primary grouping
			t0 = performance.now();
			if (!isGrouped && this.subGroupPropertyId) {
				if (!this.lastRenderWasGrouped) {
					this.clearAllTaskElements();
				}
				await this.renderGroupedBySubProperty(taskItems, visibleProperties, pathToProps);
				this.lastRenderWasGrouped = true;
				timings['renderGroupedBySubProperty'] = performance.now() - t0;
			} else if (isGrouped) {
				if (!this.lastRenderWasGrouped) {
					this.clearAllTaskElements();
				}
				await this.renderGrouped(taskItems, visibleProperties, pathToProps);
				this.lastRenderWasGrouped = true;
				timings['renderGrouped'] = performance.now() - t0;
			} else {
				if (this.lastRenderWasGrouped) {
					this.clearAllTaskElements();
				}
				await this.renderFlat(taskItems, visibleProperties);
				this.lastRenderWasGrouped = false;
				timings['renderFlat'] = performance.now() - t0;
			}

			this.cacheManager.recordRenderState(dataFingerprint, groupKey, renderSnapshot);
			this.cacheManager.updateTableSWRCache(
				this.getCacheContext(),
				taskItems,
				visibleProperties,
				isGrouped,
				!!this.subGroupPropertyId,
				this.snapshotTasksForTable.bind(this)
			);
			this.cacheManager.logRevalidatedIfNeeded();

			// Log performance timings
			const totalTime = performance.now() - renderStart;
			const timingStr = Object.entries(timings)
				.map(([k, v]) => `${k}: ${v.toFixed(1)}ms`)
				.join(', ');
			console.log(`[Taskly][Perf] render() total: ${totalTime.toFixed(1)}ms | ${timingStr} | items: ${dataItems.length}`);
		} catch (error: any) {
			console.error("[Taskly][BaseTaskView] Error rendering:", error);
			this.clearAllTaskElements();
			this.renderError(error);
		}
	}

	private visiblePropsNeedBasesData(visibleProperties: string[]): boolean {
		return visibleProperties.some(
			(prop) =>
				prop.startsWith("formula.") ||
				prop.startsWith("file.") ||
				prop.startsWith("note.")
		);
	}

	private snapshotTasksForTable(
		taskItems: TaskInfo[],
		visibleProperties: string[]
	): TaskInfo[] {
		const needsBasesData = this.visiblePropsNeedBasesData(visibleProperties);

		return taskItems.map((task) => ({
			...task,
			tags: task.tags ? [...task.tags] : undefined,
			reminders: task.reminders ? [...task.reminders] : undefined,
			complete_instances: task.complete_instances
				? [...task.complete_instances]
				: undefined,
			skipped_instances: task.skipped_instances
				? [...task.skipped_instances]
				: undefined,
			customProperties: task.customProperties ? { ...task.customProperties } : undefined,
			basesData: needsBasesData ? task.basesData : undefined,
		}));
	}

	private async renderStaleTableFromCache(): Promise<boolean> {
		if (!this.itemsContainer || !this.rootElement) return false;

		const cached = this.cacheManager.getStaleSWRCacheEntry(this.getCacheContext());
		if (!cached) return false;

		const { entry, cacheKey, resolvedKey } = cached;
		this.cacheManager.markRenderedFromCache(cacheKey, resolvedKey);

		if (entry.tasks.length === 0) {
			this.clearAllTaskElements();
			this.renderEmptyState();
			this.lastRenderWasGrouped = false;
			return true;
		}

		await this.renderFlat(entry.tasks, entry.visibleProperties);
		this.lastRenderWasGrouped = false;
		return true;
	}

	/**
	 * Compute Bases formulas for Taskly items.
	 * This ensures formulas have access to Taskly note-specific properties.
	 */
	private async computeFormulas(
		dataItems: BasesDataItem[],
		neededFormulaNames?: Set<string>
	): Promise<void> {
		// Access formulas through the data context
		const ctxFormulas = (this.data as any)?.ctx?.formulas;
		if (!ctxFormulas || typeof ctxFormulas !== "object" || dataItems.length === 0) {
			return;
		}

		const formulaNames =
			neededFormulaNames && neededFormulaNames.size > 0
				? Array.from(neededFormulaNames)
				: Object.keys(ctxFormulas);

		for (let i = 0; i < dataItems.length; i++) {
			const item = dataItems[i];
			const itemFormulaResults = item.basesData?.formulaResults;
			if (!itemFormulaResults?.cachedFormulaOutputs) continue;

			for (const formulaName of formulaNames) {
				const formula = ctxFormulas[formulaName];
				if (formula && typeof formula.getValue === "function") {
					try {
						const baseData = item.basesData;
						const taskProperties = item.properties || {};

						let result;

						// Temporarily merge Taskly note properties into frontmatter for formula access
						if (baseData.frontmatter && Object.keys(taskProperties).length > 0) {
							const originalFrontmatter = baseData.frontmatter;
							baseData.frontmatter = {
								...originalFrontmatter,
								...taskProperties,
							};
							result = formula.getValue(baseData);
							baseData.frontmatter = originalFrontmatter; // Restore original state
						} else {
							result = formula.getValue(baseData);
						}

						// Store computed result for TaskCard rendering
						if (result !== undefined) {
							itemFormulaResults.cachedFormulaOutputs[formulaName] = result;
						}
					} catch (e) {
						// Formulas may fail for various reasons - this is expected
					}
				}
			}
		}
	}

	private async renderFlat(
		taskItems: TaskInfo[],
		visiblePropertiesOverride?: string[]
	): Promise<void> {
		const visibleProperties = visiblePropertiesOverride ?? this.getVisibleProperties();

		// Apply search filter
		const filteredTasks = this.applySearchFilter(taskItems);

		// Show "no results" if search returned empty but we had tasks
		if (this.isSearchWithNoResults(filteredTasks, taskItems.length)) {
			this.clearAllTaskElements();
			if (this.itemsContainer) {
				this.renderSearchNoResults(this.itemsContainer);
			}
			return;
		}

		// Note: taskItems are already sorted by Bases according to sort configuration
		// No manual sorting needed - Bases provides pre-sorted data

		const targetDate = createUTCDateFromLocalCalendarDate(new Date());
		this.currentTargetDate = targetDate;

		const cardOptions = this.getCardOptions(targetDate);

		// Decide whether to use virtual scrolling based on filtered task count
		const shouldUseVirtualScrolling = filteredTasks.length >= this.VIRTUAL_SCROLL_THRESHOLD;

		if (shouldUseVirtualScrolling && !this.useVirtualScrolling) {
			// Switch to virtual scrolling
			this.cleanupNonVirtualRendering();
			this.useVirtualScrolling = true;
		} else if (!shouldUseVirtualScrolling && this.useVirtualScrolling) {
			// Switch back to normal rendering
			this.destroyVirtualScroller();
			this.useVirtualScrolling = false;
		}

		if (this.useVirtualScrolling) {
			await this.renderFlatVirtual(filteredTasks, visibleProperties, cardOptions);
		} else {
			await this.renderFlatNormal(filteredTasks, visibleProperties, cardOptions);
		}
	}

	private async renderFlatVirtual(
		taskItems: TaskInfo[],
		visibleProperties: string[] | undefined,
		cardOptions: any
	): Promise<void> {
		if (!this.itemsContainer) return;

		const visiblePropertiesKey = (visibleProperties ?? []).join(",");
		const renderSnapshot = this.cacheManager.getRenderSnapshot(
			this.useTableLayout,
			this.showTableHeader,
			this.currentSearchTerm,
			visiblePropertiesKey
		);
		const orderChanged = !this.arePathArraysEqual(taskItems, this.lastFlatPaths);
		const versionsChanged = this.cacheManager.haveTaskVersionsChanged(
			taskItems,
			renderSnapshot
		);

		if (
			this.useVirtualScrolling &&
			this.virtualScroller &&
			!orderChanged &&
			!versionsChanged
		) {
			return;
		}

		// Apply table container class if using table layout
		if (this.useTableLayout) {
			this.itemsContainer.classList.add("tn-table-container");
			// For virtual scrolling, we need to handle header differently
			// TODO: Add sticky header support for virtual scrolling
		} else {
			this.itemsContainer.classList.remove("tn-table-container");
		}

		if (!this.virtualScroller) {
			// Initialize virtual scroller with automatic height calculation
			this.virtualScroller = new VirtualScroller<TaskInfo>({
				container: this.itemsContainer,
				items: taskItems,
				// itemHeight omitted - will be calculated automatically from sample
				overscan: 5,
				renderItem: (taskInfo: TaskInfo, index: number) => {
					// Create card using lazy mode
					const card = createTaskCard(taskInfo, this.plugin, visibleProperties, cardOptions);

					// Cache task info for event handlers
					this.taskInfoCache.set(taskInfo.path, taskInfo);
					this.lastTaskSignatures.set(taskInfo.path, this.buildTaskSignature(taskInfo));

					return card;
				},
				getItemKey: (taskInfo: TaskInfo) => taskInfo.path,
			});

			// Force recalculation after DOM settles
			setTimeout(() => {
				this.virtualScroller?.recalculate();
			}, 0);
		} else {
			// Update existing virtual scroller with new items
			this.virtualScroller.updateItems(taskItems);
		}

		this.lastFlatPaths = taskItems.map((task) => task.path);
		this.cacheManager.updateLastRenderedTaskVersions(taskItems, renderSnapshot);
	}

	private async renderFlatNormal(
		taskItems: TaskInfo[],
		visibleProperties: string[] | undefined,
		cardOptions: any
	): Promise<void> {
		if (!this.itemsContainer) return;

		const visiblePropertiesKey = (visibleProperties ?? []).join(",");
		const renderSnapshot = this.cacheManager.getRenderSnapshot(
			this.useTableLayout,
			this.showTableHeader,
			this.currentSearchTerm,
			visiblePropertiesKey
		);
		const seenPaths = new Set<string>();
		const orderChanged = !this.arePathArraysEqual(taskItems, this.lastFlatPaths);
		const versionsChanged = this.cacheManager.haveTaskVersionsChanged(
			taskItems,
			renderSnapshot
		);

		if (
			!orderChanged &&
			!versionsChanged &&
			this.itemsContainer.childElementCount > 0
		) {
			return;
		}

		if (orderChanged) {
			this.itemsContainer.empty();
			this.currentTaskElements.clear();

			// Apply table container class and render header if using table layout
			if (this.useTableLayout) {
				this.itemsContainer.classList.add("tn-table-container");
				this.renderTableHeader();
			} else {
				this.itemsContainer.classList.remove("tn-table-container");
			}
		}

		for (const taskInfo of taskItems) {
			let cardEl = orderChanged ? null : this.currentTaskElements.get(taskInfo.path) || null;
			const signature = this.buildTaskSignature(taskInfo);
			const previousSignature = this.lastTaskSignatures.get(taskInfo.path);
			const needsUpdate = signature !== previousSignature || !cardEl;

			if (!cardEl || needsUpdate) {
				const newCard = createTaskCard(
					taskInfo,
					this.plugin,
					visibleProperties,
					cardOptions
				);
				if (cardEl && cardEl.isConnected) {
					cardEl.replaceWith(newCard);
				}
				cardEl = newCard;
			}

			if (!cardEl!.isConnected) {
				this.itemsContainer!.appendChild(cardEl!);
			}

			this.currentTaskElements.set(taskInfo.path, cardEl!);
			this.taskInfoCache.set(taskInfo.path, taskInfo);
			this.lastTaskSignatures.set(taskInfo.path, signature);
			seenPaths.add(taskInfo.path);
		}

		if (!orderChanged && seenPaths.size !== this.currentTaskElements.size) {
			for (const [path, el] of this.currentTaskElements) {
				if (!seenPaths.has(path)) {
					el.remove();
					this.currentTaskElements.delete(path);

					// Clean up related state in the same pass
					const timeout = this.clickTimeouts.get(path);
					if (timeout) {
						clearTimeout(timeout);
						this.clickTimeouts.delete(path);
					}
					this.taskInfoCache.delete(path);
					this.lastTaskSignatures.delete(path);
				}
			}
		}

		this.lastFlatPaths = taskItems.map((task) => task.path);
		this.cacheManager.updateLastRenderedTaskVersions(taskItems, renderSnapshot);
	}

	/**
	 * Build flattened list of render items (headers + tasks) for grouped view
	 * Shared between renderGrouped() and refreshGroupedView()
	 */
	private buildGroupedRenderItems(
		groups: any[],
		taskItems: TaskInfo[],
		pathToPropsOverride?: Map<string, Record<string, any>> | null
	): any[] {
		type RenderItem =
			| { type: 'primary-header'; groupKey: string; groupTitle: string; taskCount: number; groupEntries: any[]; isCollapsed: boolean }
			| { type: 'sub-header'; groupKey: string; subGroupKey: string; subGroupTitle: string; taskCount: number; isCollapsed: boolean; parentKey: string }
			| { type: 'task'; task: TaskInfo; groupKey: string; subGroupKey?: string };

		const items: RenderItem[] = [];

		// Build property map for sub-grouping if needed
		const pathToProps = this.subGroupPropertyId ? pathToPropsOverride || new Map() : new Map();

		// Build task lookup map for fast grouping (preserves Bases order via group.entries)
		const taskByPath = new Map<string, TaskInfo>();
		for (const task of taskItems) {
			taskByPath.set(task.path, task);
		}

		for (const group of groups) {
			const primaryKey = this.dataAdapter.convertGroupKeyToString(group.key);
			const groupTasks: TaskInfo[] = [];
			for (const entry of group.entries || []) {
				const entryPath = entry?.file?.path;
				if (!entryPath) continue;
				const task = taskByPath.get(entryPath);
				if (task) {
					groupTasks.push(task);
				}
			}

			// Skip groups with no matching tasks (e.g., after search filtering)
			if (groupTasks.length === 0) continue;

			const isPrimaryCollapsed = this.collapsedGroups.has(primaryKey);

			// Add primary header
			items.push({
				type: 'primary-header',
				groupKey: primaryKey,
				groupTitle: primaryKey,
				taskCount: groupTasks.length,
				groupEntries: group.entries,
				isCollapsed: isPrimaryCollapsed
			});

			// If primary group is not collapsed, add sub-groups or tasks
			if (!isPrimaryCollapsed) {
				if (this.subGroupPropertyId) {
					// Sub-grouping enabled: create nested structure
					const subGroups = this.groupTasksBySubProperty(groupTasks, this.subGroupPropertyId, pathToProps);

					for (const [subKey, subTasks] of subGroups) {
						// Filter out empty sub-groups
						if (subTasks.length === 0) continue;

						const compoundKey = `${primaryKey}:${subKey}`;
						const isSubCollapsed = this.collapsedSubGroups.has(compoundKey);

						// Add sub-header
						items.push({
							type: 'sub-header',
							groupKey: primaryKey,
							subGroupKey: subKey,
							subGroupTitle: subKey,
							taskCount: subTasks.length,
							isCollapsed: isSubCollapsed,
							parentKey: primaryKey
						});

						// Add tasks if sub-group is not collapsed
						if (!isSubCollapsed) {
							for (const task of subTasks) {
								items.push({ type: 'task', task, groupKey: primaryKey, subGroupKey: subKey });
							}
						}
					}
				} else {
					// No sub-grouping: add tasks directly
					for (const task of groupTasks) {
						items.push({ type: 'task', task, groupKey: primaryKey });
					}
				}
			}
		}

		return items;
	}

	/**
	 * Render tasks grouped by sub-property (when no primary grouping is configured).
	 * This treats the sub-group property as primary grouping.
	 */
	private async renderGroupedBySubProperty(
		taskItems: TaskInfo[],
		visiblePropertiesOverride?: string[],
		pathToPropsOverride?: Map<string, Record<string, any>> | null
	): Promise<void> {
		const visibleProperties = visiblePropertiesOverride ?? this.getVisibleProperties();

		// Apply search filter
		const filteredTasks = this.applySearchFilter(taskItems);

		// Show "no results" if search returned empty but we had tasks
		if (this.isSearchWithNoResults(filteredTasks, taskItems.length)) {
			this.clearAllTaskElements();
			if (this.itemsContainer) {
				this.renderSearchNoResults(this.itemsContainer);
			}
			return;
		}

		const targetDate = createUTCDateFromLocalCalendarDate(new Date());
		this.currentTargetDate = targetDate;
		const cardOptions = this.getCardOptions(targetDate);

		// Group tasks by sub-property
		const pathToProps = pathToPropsOverride || new Map();
		const groupedTasks = this.groupTasksBySubProperty(filteredTasks, this.subGroupPropertyId!, pathToProps);

		// Build flat items array (treat sub-groups as primary groups)
		type RenderItem =
			| { type: 'primary-header'; groupKey: string; groupTitle: string; taskCount: number; groupEntries: any[]; isCollapsed: boolean }
			| { type: 'task'; task: TaskInfo; groupKey: string };

		const items: RenderItem[] = [];
		for (const [groupKey, tasks] of groupedTasks) {
			// Skip empty groups
			if (tasks.length === 0) continue;

			const isCollapsed = this.collapsedGroups.has(groupKey);

			items.push({
				type: 'primary-header',
				groupKey,
				groupTitle: groupKey,
				taskCount: tasks.length,
				groupEntries: [], // No group entries from Bases
				isCollapsed
			});

			if (!isCollapsed) {
				for (const task of tasks) {
					items.push({ type: 'task', task, groupKey });
				}
			}
		}

		// Decide whether to use virtual scrolling
		const shouldUseVirtualScrolling = items.length >= this.VIRTUAL_SCROLL_THRESHOLD;

		// Switch rendering mode if needed
		if (this.useVirtualScrolling && shouldUseVirtualScrolling && this.virtualScroller) {
			this.virtualScroller.updateItems(items);
			this.lastFlatPaths = taskItems.map((task) => task.path);
			return;
		}

		// Full render needed
		this.itemsContainer!.empty();
		this.currentTaskElements.clear();
		this.clearClickTimeouts();
		this.taskInfoCache.clear();
		this.lastTaskSignatures.clear();

		// Apply table container class and render header if using table layout
		if (this.useTableLayout) {
			this.itemsContainer!.classList.add("tn-table-container");
			this.renderTableHeader();
		} else {
			this.itemsContainer!.classList.remove("tn-table-container");
		}

		if (shouldUseVirtualScrolling && !this.useVirtualScrolling) {
			this.cleanupNonVirtualRendering();
			this.useVirtualScrolling = true;
		} else if (!shouldUseVirtualScrolling && this.useVirtualScrolling) {
			this.destroyVirtualScroller();
			this.useVirtualScrolling = false;
		}

		if (this.useVirtualScrolling) {
			await this.renderGroupedVirtual(items, visibleProperties, cardOptions);
		} else {
			await this.renderGroupedNormal(items, visibleProperties, cardOptions);
		}

		this.lastFlatPaths = taskItems.map((task) => task.path);
	}

	private async renderGrouped(
		taskItems: TaskInfo[],
		visiblePropertiesOverride?: string[],
		pathToPropsOverride?: Map<string, Record<string, any>> | null
	): Promise<void> {
		const visibleProperties = visiblePropertiesOverride ?? this.getVisibleProperties();
		const groups = this.dataAdapter.getGroupedData();

		// Apply search filter
		const filteredTasks = this.applySearchFilter(taskItems);

		// Show "no results" if search returned empty but we had tasks
		if (this.isSearchWithNoResults(filteredTasks, taskItems.length)) {
			this.clearAllTaskElements();
			if (this.itemsContainer) {
				this.renderSearchNoResults(this.itemsContainer);
			}
			return;
		}

		const targetDate = createUTCDateFromLocalCalendarDate(new Date());
		this.currentTargetDate = targetDate;
		const cardOptions = this.getCardOptions(targetDate);

		// Build flattened list of items using shared method
		const items = this.buildGroupedRenderItems(
			groups,
			filteredTasks,
			pathToPropsOverride
		);

		// Use virtual scrolling if we have many items
		const shouldUseVirtualScrolling = items.length >= this.VIRTUAL_SCROLL_THRESHOLD;

		// If already using virtual scrolling and still need it, just update items
		if (this.useVirtualScrolling && shouldUseVirtualScrolling && this.virtualScroller) {
			this.virtualScroller.updateItems(items);
			this.lastFlatPaths = taskItems.map((task) => task.path);
			return;
		}

		// Otherwise, need to switch rendering mode or initial render
		this.itemsContainer!.empty();
		this.currentTaskElements.clear();
		this.clearClickTimeouts();
		this.taskInfoCache.clear();
		this.lastTaskSignatures.clear();

		// Apply table container class and render header if using table layout
		if (this.useTableLayout) {
			this.itemsContainer!.classList.add("tn-table-container");
			this.renderTableHeader();
		} else {
			this.itemsContainer!.classList.remove("tn-table-container");
		}

		if (shouldUseVirtualScrolling && !this.useVirtualScrolling) {
			this.cleanupNonVirtualRendering();
			this.useVirtualScrolling = true;
		} else if (!shouldUseVirtualScrolling && this.useVirtualScrolling) {
			this.destroyVirtualScroller();
			this.useVirtualScrolling = false;
		}

		if (this.useVirtualScrolling) {
			await this.renderGroupedVirtual(items, visibleProperties, cardOptions);
		} else {
			await this.renderGroupedNormal(items, visibleProperties, cardOptions);
		}

		this.lastFlatPaths = taskItems.map((task) => task.path);
	}

	private async renderGroupedVirtual(
		items: any[],
		visibleProperties: string[] | undefined,
		cardOptions: any
	): Promise<void> {
		if (!this.virtualScroller) {
			this.virtualScroller = new VirtualScroller<any>({
				container: this.itemsContainer!,
				items: items,
				// itemHeight omitted - automatically calculated from sample (headers + cards)
				overscan: 5,
				renderItem: (item: any) => {
					if (item.type === 'primary-header' || item.type === 'sub-header') {
						return this.createGroupHeader(item);
					} else {
						const cardEl = createTaskCard(item.task, this.plugin, visibleProperties, cardOptions);
						this.taskInfoCache.set(item.task.path, item.task);
						this.lastTaskSignatures.set(item.task.path, this.buildTaskSignature(item.task));
						return cardEl;
					}
				},
				getItemKey: (item: any) => {
					if (item.type === 'primary-header') {
						return `primary-${item.groupKey}`;
					} else if (item.type === 'sub-header') {
						return `sub-${item.groupKey}:${item.subGroupKey}`;
					} else {
						return item.task.path;
					}
				},
			});

			setTimeout(() => {
				this.virtualScroller?.recalculate();
			}, 0);
		} else {
			this.virtualScroller.updateItems(items);
		}
	}

	private async renderGroupedNormal(
		items: any[],
		visibleProperties: string[] | undefined,
		cardOptions: any
	): Promise<void> {
		for (const item of items) {
			if (item.type === 'primary-header' || item.type === 'sub-header') {
				const headerEl = this.createGroupHeader(item);
				this.itemsContainer!.appendChild(headerEl);
			} else {
				const cardEl = createTaskCard(item.task, this.plugin, visibleProperties, cardOptions);
				this.itemsContainer!.appendChild(cardEl);
				this.currentTaskElements.set(item.task.path, cardEl);
				this.taskInfoCache.set(item.task.path, item.task);
				this.lastTaskSignatures.set(item.task.path, this.buildTaskSignature(item.task));
			}
		}
	}

	private createGroupHeader(headerItem: any): HTMLElement {
		// Use correct document for pop-out window support
		const doc = this.containerEl.ownerDocument;

		const groupHeader = doc.createElement("div");
		groupHeader.className = "task-section task-group";

		// Determine header level and set appropriate data attributes
		const isSubHeader = headerItem.type === 'sub-header';
		const level = isSubHeader ? 'sub' : 'primary';
		groupHeader.dataset.level = level;

		if (isSubHeader) {
			groupHeader.dataset.groupKey = `${headerItem.groupKey}:${headerItem.subGroupKey}`;
			groupHeader.dataset.parentKey = headerItem.parentKey;
		} else {
			groupHeader.dataset.groupKey = headerItem.groupKey;
		}

		// Apply collapsed state
		if (headerItem.isCollapsed) {
			groupHeader.classList.add("is-collapsed");
		}

		const headerElement = doc.createElement("h3");
		headerElement.className = "task-group-header task-list-view__group-header";
		groupHeader.appendChild(headerElement);

		// Add toggle button
		const toggleBtn = doc.createElement("button");
		toggleBtn.className = "task-group-toggle";
		toggleBtn.setAttribute("aria-label", "Toggle group");
		toggleBtn.setAttribute("aria-expanded", String(!headerItem.isCollapsed));
		toggleBtn.dataset.groupKey = groupHeader.dataset.groupKey!;
		headerElement.appendChild(toggleBtn);

		// Add chevron icon
		setIcon(toggleBtn, "chevron-right");
		const svg = toggleBtn.querySelector("svg");
		if (svg) {
			svg.classList.add("chevron");
			svg.setAttribute("width", "16");
			svg.setAttribute("height", "16");
		}

		// Add group title
		const titleContainer = headerElement.createSpan({ cls: "task-group-title" });
		const displayTitle = isSubHeader ? headerItem.subGroupTitle : headerItem.groupTitle;
		this.renderGroupTitle(titleContainer, displayTitle);

		// Add count
		headerElement.createSpan({
			text: ` (${headerItem.taskCount})`,
			cls: "agenda-view__item-count",
		});

		return groupHeader;
	}

	protected async handleTaskUpdate(task: TaskInfo): Promise<void> {
		// Update cache
		this.taskInfoCache.set(task.path, task);
		this.lastTaskSignatures.set(task.path, this.buildTaskSignature(task));

		// Always do a full refresh to ensure correct sort order
		// In-place card replacement skips re-sorting, causing tasks to stay
		// in wrong position after status changes
		this.debouncedRefresh();
	}

	private renderEmptyState(): void {
		const doc = this.containerEl.ownerDocument;
		const emptyEl = doc.createElement("div");
		emptyEl.className = "tn-bases-empty";

		// Icon
		const iconEl = emptyEl.createDiv({ cls: "task-list-view__empty-icon" });
		setIcon(iconEl, "check-square");

		// Title
		emptyEl.createDiv({
			cls: "task-list-view__empty-title",
			text: "No tasks yet",
		});

		// Description with shortcut hint
		const isMac = navigator.platform?.includes("Mac") || false;
		const shortcut = isMac ? "\u2318+J" : "Ctrl+J";
		emptyEl.createDiv({
			cls: "task-list-view__empty-description",
			text: `Create your first task with ${shortcut}`,
		});

		this.itemsContainer!.appendChild(emptyEl);
	}

	renderError(error: Error): void {
		// Use correct document for pop-out window support
		const doc = this.containerEl.ownerDocument;
		const errorEl = doc.createElement("div");
		errorEl.className = "tn-bases-error";
		errorEl.style.cssText =
			"padding: 20px; color: #d73a49; background: #ffeaea; border-radius: 4px; margin: 10px 0;";
		errorEl.textContent = `Error loading tasks: ${error.message || "Unknown error"}`;
		this.itemsContainer!.appendChild(errorEl);
	}

	/**
	 * Render group title using shared utility.
	 * Uses this.app from BasesView (with fallback to plugin.app for safety).
	 */
	private renderGroupTitle(container: HTMLElement, title: string): void {
		// Use this.app if available (set by Bases), otherwise fall back to plugin.app
		const app = this.app || this.plugin.app;

		const linkServices: LinkServices = {
			metadataCache: app.metadataCache,
			workspace: app.workspace,
		};

		renderGroupTitle(container, title, linkServices);
	}

	/**
	 * Component lifecycle: Called when component is unloaded.
	 * Override from Component base class.
	 */
	onunload(): void {
		// Component.register() calls will be automatically cleaned up (including search cleanup)
		// We just need to clean up view-specific state
		this.unregisterContainerListeners();
		this.destroyVirtualScroller();

		this.currentTaskElements.clear();
		this.itemsContainer = null;
		this.lastRenderWasGrouped = false;
		this.clearClickTimeouts();
		this.taskInfoCache.clear();
		this.cacheManager.reset();
		this.lastTaskSignatures.clear();
		this.lastFlatPaths = [];
		this.useVirtualScrolling = false;
		this.collapsedGroups.clear();
		this.collapsedSubGroups.clear();
	}

	/**
	 * Get ephemeral state to preserve across view reloads.
	 * Saves scroll position, collapsed groups, and collapsed sub-groups.
	 */
	getEphemeralState(): any {
		return {
			scrollTop: this.rootElement?.scrollTop || 0,
			collapsedGroups: Array.from(this.collapsedGroups),
			collapsedSubGroups: Array.from(this.collapsedSubGroups),
		};
	}

	/**
	 * Restore ephemeral state after view reload.
	 * Restores scroll position, collapsed groups, and collapsed sub-groups.
	 */
	setEphemeralState(state: any): void {
		if (!state) return;

		// Restore collapsed groups immediately
		if (state.collapsedGroups && Array.isArray(state.collapsedGroups)) {
			this.collapsedGroups = new Set(state.collapsedGroups);
		}

		// Restore collapsed sub-groups immediately
		if (state.collapsedSubGroups && Array.isArray(state.collapsedSubGroups)) {
			this.collapsedSubGroups = new Set(state.collapsedSubGroups);
		}

		// Restore scroll position after render completes
		if (state.scrollTop !== undefined && this.rootElement) {
			// Use requestAnimationFrame to ensure DOM is ready
			requestAnimationFrame(() => {
				if (this.rootElement && this.rootElement.isConnected) {
					this.rootElement.scrollTop = state.scrollTop;
				}
			});
		}
	}

	private clearAllTaskElements(): void {
		if (this.useVirtualScrolling) {
			this.destroyVirtualScroller();
			this.useVirtualScrolling = false;
		}
		this.itemsContainer?.empty();
		this.currentTaskElements.forEach((el) => el.remove());
		this.currentTaskElements.clear();
		this.lastFlatPaths = [];
		this.lastTaskSignatures.clear();
		this.taskInfoCache.clear();
		this.clearClickTimeouts();
	}

	private getCardOptions(targetDate: Date) {
		return {
			targetDate,
			layout: this.useTableLayout ? "table" as const : "default" as const,
		};
	}

	/**
	 * Render table header row when using table layout.
	 */
	private renderTableHeader(): void {
		if (!this.itemsContainer || !this.useTableLayout || !this.showTableHeader) return;

		const doc = this.containerEl.ownerDocument;
		const header = doc.createElement("div");
		header.className = "tn-table-header";

		// Status column (empty header)
		header.createEl("div", { cls: "tn-table-header__col tn-table-header__col--status" });

		// Name column
		header.createEl("div", { cls: "tn-table-header__col tn-table-header__col--name", text: "Name" });

		// Due date column
		header.createEl("div", { cls: "tn-table-header__col tn-table-header__col--due", text: "Due" });

		// Date added column
		header.createEl("div", { cls: "tn-table-header__col tn-table-header__col--date", text: "Added" });

		// Context menu column (empty header)
		header.createEl("div", { cls: "tn-table-header__col tn-table-header__col--menu" });

		this.itemsContainer.appendChild(header);
	}

	private clearClickTimeouts(): void {
		for (const timeout of this.clickTimeouts.values()) {
			if (timeout) {
				clearTimeout(timeout);
			}
		}
		this.clickTimeouts.clear();
	}

	private registerContainerListeners(): void {
		if (!this.itemsContainer || this.containerListenersRegistered) return;

		// Register click listener for group header collapse/expand using Component API
		// This automatically cleans up on component unload
		this.registerDomEvent(this.itemsContainer, "click", this.handleItemClick);
		this.containerListenersRegistered = true;
	}

	private unregisterContainerListeners(): void {
		// No manual cleanup needed - Component.registerDomEvent handles it automatically
		this.containerListenersRegistered = false;
	}

	private getTaskContextFromEvent(event: Event): { task: TaskInfo; card: HTMLElement } | null {
		const target = event.target as HTMLElement | null;
		if (!target) return null;
		const card = target.closest<HTMLElement>(".task-card");
		if (!card) return null;
		const path = card.dataset.taskPath;
		if (!path) return null;
		const task = this.taskInfoCache.get(path);
		if (!task) return null;
		return { task, card };
	}

	private handleItemClick = async (event: MouseEvent) => {
		const target = event.target as HTMLElement;

		// ONLY handle group header clicks - task cards handle their own clicks
		const groupHeader = target.closest<HTMLElement>(".task-group-header");
		if (groupHeader) {
			const groupSection = groupHeader.closest<HTMLElement>(".task-group");
			const groupKey = groupSection?.dataset.groupKey;

			if (groupKey) {
				// Don't toggle if clicking on a link
				if (target.closest("a")) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				await this.handleGroupToggle(groupKey);
				return;
			}
		}

		// Don't handle task card clicks here - they have their own handlers
		// This prevents double-firing when clicking on tasks
	};

	private async handleGroupToggle(groupKey: string): Promise<void> {
		// Detect if this is a sub-group toggle (compound key contains colon)
		const isSubGroup = groupKey.includes(':');

		if (isSubGroup) {
			// Toggle sub-group collapsed state
			if (this.collapsedSubGroups.has(groupKey)) {
				this.collapsedSubGroups.delete(groupKey);
			} else {
				this.collapsedSubGroups.add(groupKey);
			}
		} else {
			// Toggle primary group collapsed state
			if (this.collapsedGroups.has(groupKey)) {
				this.collapsedGroups.delete(groupKey);
			} else {
				this.collapsedGroups.add(groupKey);
			}
		}

		// Rebuild items and update virtual scroller without full re-render
		if (this.lastRenderWasGrouped) {
			await this.refreshGroupedView();
		}
	}

	private async refreshGroupedView(): Promise<void> {
		if (!this.data?.data) return;

		const dataItems = this.dataAdapter.extractDataItems();
		const visibleProperties = this.getVisibleProperties();
		const neededFormulaNames = this.getNeededFormulaNames(
			visibleProperties,
			this.subGroupPropertyId
		);
		if (neededFormulaNames.size > 0) {
			await this.computeFormulas(dataItems, neededFormulaNames);
		}
		const taskItems = this.cacheManager.identifyTasklyMemoized(dataItems);
		const pathToProps = this.subGroupPropertyId
			? this.buildPathToPropsMapFromDataItems(
					dataItems,
					neededFormulaNames.size > 0
			  )
			: null;
		const groups = this.dataAdapter.getGroupedData();

		// Build flattened list of items using shared method
		const items = this.buildGroupedRenderItems(groups, taskItems, pathToProps);

		// Update virtual scroller with new items
		if (this.useVirtualScrolling && this.virtualScroller) {
			this.virtualScroller.updateItems(items);
			const isGrouped = this.dataAdapter.isGrouped();
			this.cacheManager.updateTableSWRCache(
				this.getCacheContext(),
				taskItems,
				visibleProperties,
				isGrouped,
				!!this.subGroupPropertyId,
				this.snapshotTasksForTable.bind(this)
			);
		} else {
			// If not using virtual scrolling, do full render
			await this.render();
		}
	}

	private handleItemContextMenu = async (event: MouseEvent) => {
		const context = this.getTaskContextFromEvent(event);
		if (!context) return;
		event.preventDefault();
		event.stopPropagation();

		// If multiple tasks are selected, show batch context menu
		const selectionService = this.plugin.taskSelectionService;
		if (selectionService && selectionService.getSelectionCount() > 1) {
			// Ensure the right-clicked task is in the selection
			if (!selectionService.isSelected(context.task.path)) {
				selectionService.addToSelection(context.task.path);
			}
			this.showBatchContextMenu(event);
			return;
		}

		await showTaskContextMenu(event, context.task.path, this.plugin, this.currentTargetDate);
	};

	private handleItemPointerOver = (event: PointerEvent) => {
		if ("pointerType" in event && event.pointerType !== "mouse") {
			return;
		}
		const context = this.getTaskContextFromEvent(event);
		if (!context) return;

		const related = event.relatedTarget as HTMLElement | null;
		if (related && context.card.contains(related)) {
			return;
		}

		const app = this.app || this.plugin.app;
		const file = app.vault.getAbstractFileByPath(context.task.path);
		if (file) {
			app.workspace.trigger("hover-link", {
				event: event as MouseEvent,
				source: "taskly-task-card",
				hoverParent: context.card,
				targetEl: context.card,
				linktext: context.task.path,
				sourcePath: context.task.path,
			});
		}
	};

	private async handleActionClick(
		action: string,
		task: TaskInfo,
		target: HTMLElement,
		event: MouseEvent
	): Promise<void> {
		switch (action) {
			case "toggle-status":
				await this.handleToggleStatus(task, event);
				return;
			case "recurrence-menu":
				this.showRecurrenceMenu(task, event);
				return;
			case "reminder-menu":
				this.showReminderModal(task);
				return;
			case "task-context-menu":
				await showTaskContextMenu(event, task.path, this.plugin, this.getTaskActionDate(task));
				return;
			case "edit-date":
				await this.openDateContextMenu(task, target.dataset.tnDateType as "due" | undefined, event);
				return;
			default:
				await this.handleCardClick(task, event);
		}
	}

	private async handleToggleStatus(task: TaskInfo, event: MouseEvent): Promise<void> {
		try {
			if (task.recurrence) {
				const actionDate = this.getTaskActionDate(task);
				await this.plugin.toggleRecurringTaskComplete(task, actionDate);
			} else {
				await this.plugin.toggleTaskStatus(task);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[Taskly][BaseTaskView] Failed to toggle status", {
				error: message,
				taskPath: task.path,
			});
			new Notice(`Failed to toggle task status: ${message}`);
		}
	}

	/**
	 * Determine the date to use when completing a recurring task from Bases.
	 * Prefers the task's due date to avoid marking the wrong instance.
	 */
	private getTaskActionDate(task: TaskInfo): Date {
		const dateStr = getDatePart(task.due || "");
		if (dateStr) {
			return parseDateToUTC(dateStr);
		}

		return this.currentTargetDate;
	}

	private showRecurrenceMenu(task: TaskInfo, event: MouseEvent): void {
		const menu = new RecurrenceContextMenu({
			currentValue: typeof task.recurrence === "string" ? task.recurrence : undefined,
			currentAnchor: task.recurrence_anchor || 'due',
			onSelect: async (newRecurrence: string | null, anchor?: 'due' | 'completion') => {
				try {
					await this.plugin.updateTaskProperty(
						task,
						"recurrence",
						newRecurrence || undefined
					);
					if (anchor !== undefined) {
						await this.plugin.updateTaskProperty(
							task,
							"recurrence_anchor",
							anchor
						);
					}
				} catch (error) {
					console.error("[Taskly][BaseTaskView] Failed to update recurrence", error);
					new Notice("Failed to update recurrence");
				}
			},
			app: this.plugin.app,
			plugin: this.plugin,
		});
		menu.show(event);
	}

	private showReminderModal(task: TaskInfo): void {
		const modal = new ReminderModal(this.plugin.app, this.plugin, task, async (reminders) => {
			try {
				await this.plugin.updateTaskProperty(
					task,
					"reminders",
					reminders.length > 0 ? reminders : undefined
				);
			} catch (error) {
				console.error("[Taskly][BaseTaskView] Failed to update reminders", error);
				new Notice("Failed to update reminders");
			}
		});
		modal.open();
	}

	private async openDateContextMenu(
		task: TaskInfo,
		dateType: "due" | undefined,
		event: MouseEvent
	): Promise<void> {
		if (!dateType) return;
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
					await this.plugin.updateTaskProperty(task, "due", finalValue);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error("[Taskly][BaseTaskView] Failed to update date", {
						error: message,
						taskPath: task.path,
						dateType,
					});
					new Notice(`Failed to update ${dateType} date: ${message}`);
				}
			},
			plugin: this.plugin,
			app: this.app || this.plugin.app,
		});
		menu.show(event);
	}

	private async handleCardClick(task: TaskInfo, event: MouseEvent): Promise<void> {
		// Check if this is a selection click (shift/ctrl/cmd or in selection mode)
		if (this.handleSelectionClick(event, task.path)) {
			return;
		}

		if (this.plugin.settings.doubleClickAction === "none") {
			await this.executeSingleClickAction(task, event);
			return;
		}

		const existingTimeout = this.clickTimeouts.get(task.path);
		if (existingTimeout) {
			clearTimeout(existingTimeout);
			this.clickTimeouts.delete(task.path);
			await this.executeDoubleClickAction(task, event);
		} else {
			// Use correct window for pop-out window support
			const win = this.containerEl.ownerDocument.defaultView || window;
			const timeout = win.setTimeout(async () => {
				this.clickTimeouts.delete(task.path);
				await this.executeSingleClickAction(task, event);
			}, 250);
			this.clickTimeouts.set(task.path, timeout);
		}
	}

	private async executeSingleClickAction(task: TaskInfo, event: MouseEvent): Promise<void> {
		if (event.ctrlKey || event.metaKey) {
			this.openTaskFile(task, true);
			return;
		}

		switch (this.plugin.settings.singleClickAction) {
			case "openNote":
				this.openTaskFile(task, false);
				break;
			default:
				break;
		}
	}

	private async executeDoubleClickAction(task: TaskInfo, event: MouseEvent): Promise<void> {
		switch (this.plugin.settings.doubleClickAction) {
			case "openNote":
				this.openTaskFile(task, false);
				break;
			default:
				break;
		}
	}

	private openTaskFile(task: TaskInfo, newTab: boolean): void {
		const app = this.app || this.plugin.app;
		const file = app.vault.getAbstractFileByPath(task.path);
		if (file instanceof TFile) {
			const leaf = app.workspace.getLeaf("split", "vertical");
			leaf.openFile(file);
		}
	}

	private arePathArraysEqual(taskItems: TaskInfo[], previousPaths: string[]): boolean {
		if (taskItems.length !== previousPaths.length) return false;
		for (let i = 0; i < taskItems.length; i++) {
			if (taskItems[i].path !== previousPaths[i]) return false;
		}
		return true;
	}

	private cleanupNonVirtualRendering(): void {
		this.itemsContainer?.empty();
		this.currentTaskElements.clear();
		this.clearClickTimeouts();
	}

	private destroyVirtualScroller(): void {
		if (this.virtualScroller) {
			this.virtualScroller.destroy();
			this.virtualScroller = null;
		}
	}

	/**
	 * Build a map of task path -> properties for fast lookup during grouping.
	 * Similar to the pattern used for grouped rendering.
	 * Includes both regular properties and formula results.
	 */
	private buildPathToPropsMapFromDataItems(
		dataItems: BasesDataItem[],
		includeFormulaOutputs: boolean
	): Map<string, Record<string, any>> {
		const map = new Map<string, Record<string, any>>();
		for (const item of dataItems) {
			if (item.path) {
				// Merge regular properties with formula results
				const props = { ...(item.properties || {}) };

				// Add formula results if available
				const formulaOutputs = includeFormulaOutputs
					? item.basesData?.formulaResults?.cachedFormulaOutputs
					: null;
				if (formulaOutputs && typeof formulaOutputs === 'object') {
					for (const [formulaName, value] of Object.entries(formulaOutputs)) {
						// Store with formula. prefix for easy lookup
						props[`formula.${formulaName}`] = value;
					}
				}

				map.set(item.path, props);
			}
		}
		return map;
	}

	/**
	 * Determine which formulas are required for this render.
	 * We only compute formulas when they are visible as columns or used for sub-grouping.
	 */
	private getNeededFormulaNames(
		visibleProperties: string[] | undefined,
		subGroupPropertyId: string | null
	): Set<string> {
		const needed = new Set<string>();

		if (visibleProperties) {
			for (const prop of visibleProperties) {
				if (prop.startsWith("formula.")) {
					needed.add(prop.substring("formula.".length));
				}
			}
		}

		if (subGroupPropertyId && subGroupPropertyId.startsWith("formula.")) {
			needed.add(subGroupPropertyId.substring("formula.".length));
		}

		return needed;
	}


	/**
	 * Get property value from properties object using property ID.
	 * Handles TaskInfo properties, Bases property IDs (note.*, task.*, file.*), and formulas (formula.*).
	 */
	private getPropertyValue(props: Record<string, any>, propertyId: string): any {
		if (!propertyId) return null;

		// Formula properties are stored with their full prefix (formula.NAME)
		if (propertyId.startsWith('formula.')) {
			return props[propertyId] ?? null;
		}

		// Strip prefix (note., task., file.) from property ID
		const cleanPropertyId = propertyId.replace(/^(note\.|task\.|file\.)/, '');

		// Get value from properties
		return props[cleanPropertyId] ?? null;
	}

	/**
	 * Convert a property value to a display string for grouping.
	 * Handles null, undefined, arrays, objects, primitives, and Bases Value objects.
	 */
	private valueToString(value: any): string {
		if (value === null || value === undefined) {
			return "None";
		}

		// Handle Bases Value objects (they have a toString() method and often a type property)
		// Check for Bases Value object by duck-typing (has toString and is an object with constructor)
		if (typeof value === "object" && value !== null && typeof value.toString === "function") {
			// Check if it's a Bases NullValue
			if (value.constructor?.name === "NullValue" || (value.isTruthy && !value.isTruthy())) {
				return "None";
			}

			// Check if it's a Bases ListValue (array-like)
			if (value.constructor?.name === "ListValue" || (Array.isArray(value.value))) {
				const arr = value.value || [];
				if (arr.length === 0) return "None";
				// Recursively convert each item
				return arr.map((v: any) => this.valueToString(v)).join(", ");
			}

			// For other Bases Value types (StringValue, NumberValue, BooleanValue, DateValue, etc.)
			// Use their toString() method
			const str = value.toString();
			return str || "None";
		}

		if (typeof value === "string") {
			return value || "None";
		}

		if (typeof value === "number") {
			return String(value);
		}

		if (typeof value === "boolean") {
			return value ? "True" : "False";
		}

		if (Array.isArray(value)) {
			return value.length > 0 ? value.map((v) => this.valueToString(v)).join(", ") : "None";
		}

		return String(value);
	}

	/**
	 * Group tasks by a sub-property for nested grouping.
	 * Returns a Map of sub-group key -> tasks.
	 */
	private groupTasksBySubProperty(
		tasks: TaskInfo[],
		propertyId: string,
		pathToProps: Map<string, Record<string, any>>
	): Map<string, TaskInfo[]> {
		const subGroups = new Map<string, TaskInfo[]>();

		for (const task of tasks) {
			const props = pathToProps.get(task.path) || {};
			const subValue = this.getPropertyValue(props, propertyId);
			const subKey = this.valueToString(subValue);

			if (!subGroups.has(subKey)) {
				subGroups.set(subKey, []);
			}
			subGroups.get(subKey)!.push(task);
		}

		return subGroups;
	}

	private buildTaskSignature(task: TaskInfo): string {
		// Fast signature using only fields that affect rendering
		const tagsKey = task.tags ? [...task.tags].sort().join(",") : "";
		let customKey = "";
		if (task.customProperties) {
			try {
				customKey = JSON.stringify(task.customProperties);
			} catch {
				customKey = "";
			}
		}
		return `${task.path}|${task.title}|${task.status}|${task.due}|${task.recurrence}|${task.archived}|${task.complete_instances?.join(',')}|${task.reminders?.length}|${tagsKey}|${customKey}`;
	}
}
