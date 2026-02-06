import { formatString } from "./utils/stringFormat";
/* eslint-disable no-console */
import {
	Notice,
	Plugin,
	WorkspaceLeaf,
	Editor,
	MarkdownView,
	TFile,
	Platform,
	Command,
	Hotkey,
	normalizePath,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { format } from "date-fns";
import {
	createDailyNote,
	getDailyNote,
	getAllDailyNotes,
	appHasDailyNotesPluginLoaded,
} from "obsidian-daily-notes-interface";
import { TasklySettings } from "./types/settings";
import { DEFAULT_SETTINGS } from "./settings/defaults";
import { TasklySettingTab } from "./settings/TasklySettingTab";
import { generateBasesFileTemplate } from "./templates/defaultBasesFiles";
import {
	TaskInfo,
	StatusConfig,
	EVENT_DATA_CHANGED,
	EVENT_TASK_UPDATED,
	EVENT_DATE_CHANGED,
} from "./types";

import { TaskCreationModal } from "./modals/TaskCreationModal";
import { openTaskSelector } from "./modals/TaskSelectorWithCreateModal";
import { formatTime } from "./utils/helpers";
import { convertUTCToLocalCalendarDate, getCurrentTimestamp } from "./utils/dateUtils";
import { TaskManager } from "./utils/TaskManager";
import { DOMReconciler, UIStateManager } from "./utils/DOMReconciler";
import { perfMonitor } from "./utils/PerformanceMonitor";
import { FieldMapper } from "./services/FieldMapper";
import { StatusManager } from "./services/StatusManager";
import { TaskService } from "./services/TaskService";
import { FilterService } from "./services/FilterService";
import { ViewPerformanceService } from "./services/ViewPerformanceService";
import { AutoArchiveService } from "./services/AutoArchiveService";
import { ViewStateManager } from "./services/ViewStateManager";
import { createTaskLinkOverlay, dispatchTaskUpdate } from "./editor/TaskLinkOverlay";
import { createReadingModeTaskLinkProcessor } from "./editor/ReadingModeTaskLinkProcessor";
import {
	formatDateForStorage,
	createUTCDateFromLocalCalendarDate,
	parseDateToLocal,
	getTodayLocal,
} from "./utils/dateUtils";
import { NotificationService } from "./services/NotificationService";
// Type-only import for HTTPAPIService (actual import is dynamic on desktop only)
import type { HTTPAPIService } from "./services/HTTPAPIService";

interface CommandDefinition {
	id: string;
	name: string;
	callback?: () => void | Promise<void>;
	editorCallback?: (editor: Editor, view: MarkdownView) => void | Promise<void>;
	checkCallback?: (checking: boolean) => boolean | void;
	hotkeys?: Hotkey[];
}

export default class TasklyPlugin extends Plugin {
	settings: TasklySettings;

	// Track cache-related settings to avoid unnecessary re-indexing
	private previousCacheSettings: {
		taskTag: string;
		excludedFolders: string;
		storeTitleInFilename: boolean;
		fieldMapping: any;
	} | null = null;

	// Date change detection for refreshing task states at midnight
	private lastKnownDate: string = new Date().toDateString();
	private dateCheckInterval: number;
	private midnightTimeout: number;

	// Ready promise to signal when initialization is complete
	private readyPromise: Promise<void>;
	private resolveReady: () => void;

	// Task manager for just-in-time task lookups (also handles events)
	cacheManager: TaskManager;
	emitter: TaskManager;


	// Performance optimization utilities
	domReconciler: DOMReconciler;
	uiStateManager: UIStateManager;

	// Customization services
	fieldMapper: FieldMapper;
	statusManager: StatusManager;

	// Business logic services
	taskService: TaskService;
	filterService: FilterService;
	viewStateManager: ViewStateManager;
	autoArchiveService: AutoArchiveService;
	viewPerformanceService: ViewPerformanceService;

	// Task selection service for batch operations
	taskSelectionService: import("./services/TaskSelectionService").TaskSelectionService;

	// Editor services
	taskLinkDetectionService?: import("./services/TaskLinkDetectionService").TaskLinkDetectionService;
	instantTaskConvertService?: import("./services/InstantTaskConvertService").InstantTaskConvertService;

	// Notification service
	notificationService: NotificationService;

	// HTTP API service
	apiService?: HTTPAPIService;

	// License service for Lemon Squeezy validation

	// Bases filter converter for exporting saved views
	basesFilterConverter: import("./services/BasesFilterConverter").BasesFilterConverter;

	// Command registration support
	private commandDefinitions: CommandDefinition[] = [];
	private registeredCommands = new Map<string, string>();

	// Event listener cleanup
	private taskUpdateListenerForEditor: import("obsidian").EventRef | null = null;

	// Initialization guard to prevent duplicate initialization
	private initializationComplete = false;
	private lazyInitComplete = false;

	// Bases registration state management
	private basesRegistered = false;

	async onload() {
		// Create the promise and store its resolver
		this.readyPromise = new Promise((resolve) => {
			this.resolveReady = resolve;
		});

		await this.loadSettings();

		// Initialize only essential services that are needed for app registration
		this.fieldMapper = new FieldMapper(this.settings.fieldMapping);
		this.statusManager = new StatusManager(this.settings.customStatuses);

		// Initialize performance optimization utilities (lightweight)
		this.domReconciler = new DOMReconciler();
		this.uiStateManager = new UIStateManager();

		// Initialize task manager for just-in-time task lookups
		this.cacheManager = new TaskManager(this.app, this.settings, this.fieldMapper);

		// Use same instance for event emitting
		this.emitter = this.cacheManager;

		// Initialize business logic services (lightweight constructors)
		this.taskService = new TaskService(this);
		this.filterService = new FilterService(
			this.cacheManager,
			this.statusManager,
			this
		);
		this.viewStateManager = new ViewStateManager(this.app, this);
		this.autoArchiveService = new AutoArchiveService(this);

		// Initialize task selection service for batch operations
		const { TaskSelectionService } = require("./services/TaskSelectionService");
		this.taskSelectionService = new TaskSelectionService(this);
		this.notificationService = new NotificationService(this);
		this.viewPerformanceService = new ViewPerformanceService(this);

		// Initialize Bases filter converter for saved view export
		const { BasesFilterConverter } = await import("./services/BasesFilterConverter");
		this.basesFilterConverter = new BasesFilterConverter(this);

		// Connect AutoArchiveService to TaskService for status-based auto-archiving
		this.taskService.setAutoArchiveService(this.autoArchiveService);

		// Note: View registration and heavy operations moved to onLayoutReady

		// Add ribbon icons
		this.addRibbonIcon("inbox", "Inbox", async () => {
			await this.openBasesFileForCommand('open-table-view');
		});

		this.addRibbonIcon("plus", "Create new task", () => {
			this.openTaskCreationModal();
		});

		// Add commands
		this.addCommands();

		// Add settings tab
		this.addSettingTab(new TasklySettingTab(this.app, this));

		// Early registration attempt for Bases integration
		if (this.settings?.enableBases && !this.basesRegistered) {
			try {
				const { registerBasesTaskList } = await import("./bases/registration");
				await registerBasesTaskList(this);
				this.basesRegistered = true;
			} catch (e) {
				// eslint-disable-next-line no-console
				console.debug("[Taskly][Bases] Early registration failed:", e);
			}
		}

		// Defer expensive initialization until layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.initializeAfterLayoutReady();
		});

		// At the very end of onload, resolve the promise to signal readiness
		this.resolveReady();
	}

	/**
	 * Initialize HTTP API service (desktop only)
	 */
	private async initializeHTTPAPI(): Promise<void> {
		// Only initialize on desktop and if API is enabled
		if (Platform.isMobile || !this.settings.enableAPI) {
			return;
		}

		try {
			// Use dynamic import() to load HTTPAPIService only on desktop
			const { HTTPAPIService } = await import("./services/HTTPAPIService");

			this.apiService = new HTTPAPIService(
				this,
				this.taskService,
				this.filterService,
				this.cacheManager
			);

			// Connect webhook notifier to TaskService for file-based operations
			this.taskService.setWebhookNotifier(this.apiService);

			// Start the API server
			await this.apiService.start();
			new Notice(`Taskly API started on port ${this.apiService.getPort()}`);
		} catch (error) {
			console.error("Failed to initialize HTTP API:", error);
			new Notice("Failed to start Taskly API server. Check console for details.");
		}
	}

	/**
	 * Initialize expensive operations after layout is ready
	 */
	private async initializeAfterLayoutReady(): Promise<void> {
		// Guard against multiple initialization calls
		if (this.initializationComplete) {
			return;
		}
		this.initializationComplete = true;

		try {
			// Ensure default Bases command files exist
			// Deferred to here (after layout ready) to avoid race conditions with file explorer cache
			await this.ensureBasesViewFiles();

			// Inject dynamic styles for custom statuses and priorities
			this.injectCustomStyles();

			// Register essential editor extensions (now safe after layout ready)
			this.registerEditorExtension(createTaskLinkOverlay(this));

			// Register reading mode task link processor
			this.registerMarkdownPostProcessor(createReadingModeTaskLinkProcessor(this));

			// Initialize task manager (lightweight - no index building)
			this.cacheManager.initialize();

			// Initialize FilterService and set up event listeners (lightweight)
			this.filterService.initialize();

			// Initialize notification service
			await this.notificationService.initialize();

			// Warm up TaskManager indexes for better performance
			await this.warmupTaskIndexes();

			// Initialize and start auto-archive service
			await this.autoArchiveService.start();

			// Initialize date change detection to refresh tasks at midnight
			this.setupDateChangeDetection();

			// Defer heavy service initialization until needed
			this.initializeServicesLazily();

			// Register Taskly views with Bases plugin (if enabled and not already registered)
			if (this.settings?.enableBases && !this.basesRegistered) {
				try {
					const { registerBasesTaskList } = await import("./bases/registration");
					await registerBasesTaskList(this);
					this.basesRegistered = true;
				} catch (e) {
					console.debug("[Taskly][Bases] Registration failed:", e);
				}
			}
		} catch (error) {
			console.error("Error during post-layout initialization:", error);
			new Notice("Taskly failed to fully initialize. Check the console for details.", 10000);
		}
	}

	/**
	 * Initialize heavy services lazily in the background
	 */
	private initializeServicesLazily(): void {
		if (this.lazyInitComplete) return;
		this.lazyInitComplete = true;
		// Use setTimeout to defer initialization to next tick
		setTimeout(async () => {
			try {
				// Initialize HTTP API service if enabled (desktop only)
				await this.initializeHTTPAPI();

				// Initialize editor services (async imports)
				const { TaskLinkDetectionService } = await import(
					"./services/TaskLinkDetectionService"
				);
				this.taskLinkDetectionService = new TaskLinkDetectionService(this);

				const { InstantTaskConvertService } = await import(
					"./services/InstantTaskConvertService"
				);
				this.instantTaskConvertService = new InstantTaskConvertService(
					this,
					this.statusManager
				);

				// Register additional editor extensions
				const { createInstantConvertButtons } = await import(
					"./editor/InstantConvertButtons"
				);
				this.registerEditorExtension(createInstantConvertButtons(this));

				// Set up global event listener for task updates to refresh editor decorations
				this.taskUpdateListenerForEditor = this.emitter.on(
					EVENT_TASK_UPDATED,
					(data: { path?: string; updatedTask?: TaskInfo }) => {
						// Trigger decoration refresh in all active markdown views using proper state effects
						this.app.workspace.iterateRootLeaves((leaf) => {
							// Use instanceof check for deferred view compatibility
							if (leaf.view && leaf.view.getViewType() === "markdown") {
								const editor = (leaf.view as MarkdownView).editor;
								if (editor && (editor as Editor & { cm?: EditorView }).cm) {
									// Use the proper CodeMirror state effect pattern
									// Pass the updated task path to ensure specific widget refreshing
									const taskPath = data?.path || data?.updatedTask?.path;
									dispatchTaskUpdate(
										(editor as Editor & { cm: EditorView }).cm,
										taskPath
									);
								}
							}
						});
					}
				);

				// Set up workspace event listener for active leaf changes to refresh task overlays
				this.registerEvent(
					this.app.workspace.on("active-leaf-change", (leaf) => {
						// Small delay to ensure editor is fully initialized
						setTimeout(() => {
							if (leaf && leaf.view && leaf.view.getViewType() === "markdown") {
								const editor = (leaf.view as MarkdownView).editor;
								if (editor && (editor as Editor & { cm?: EditorView }).cm) {
									// Dispatch task update to refresh overlays when returning to a note
									dispatchTaskUpdate((editor as Editor & { cm: EditorView }).cm);

								}
							}
						}, 50);
					})
				);

				// Set up workspace event listener for layout changes to detect mode switches
				this.registerEvent(
					this.app.workspace.on("layout-change", () => {
						// Small delay to ensure mode switch is complete
						setTimeout(() => {
							const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
							if (activeView) {
								const editor = activeView.editor;
								if (editor && (editor as Editor & { cm?: EditorView }).cm) {
									// Refresh overlays when switching to Live Preview mode
									dispatchTaskUpdate((editor as Editor & { cm: EditorView }).cm);

								}
							}
						}, 100);
					})
				);

			} catch (error) {
				console.error("Error during lazy service initialization:", error);
			}
		}, 10); // Small delay to ensure startup completes first
	}

	/**
	 * Warm up TaskManager indexes for better performance
	 */
	private async warmupTaskIndexes(): Promise<void> {
		try {
			// Simple approach: just trigger the lazy index building once
			// This is much more efficient than processing individual files
			const warmupStartTime = Date.now();

			// Trigger index building with a single call - this will process all files internally
			this.cacheManager.getTasksForDate(new Date().toISOString().split("T")[0]);

			const duration = Date.now() - warmupStartTime;
			// Only log slow warmup for debugging large vaults
			if (duration > 2000) {
				// eslint-disable-next-line no-console
				console.log(`[Taskly] Task indexes warmed up in ${duration}ms`);
			}
		} catch (error) {
			console.error("[Taskly] Error during task index warmup:", error);
		}
	}

	/**
	 * Public method for views to wait for readiness
	 */
	async onReady(): Promise<void> {
		// If readyPromise doesn't exist, plugin hasn't started onload yet
		if (!this.readyPromise) {
			throw new Error("Plugin not yet initialized");
		}

		await this.readyPromise;
	}

	// Methods for updating shared state and emitting events

	/**
	 * Notify views that data has changed and views should refresh
	 * @param filePath Optional path of the file that changed (for targeted cache invalidation)
	 * @param force Whether to force a full cache rebuild
	 * @param triggerRefresh Whether to trigger a full UI refresh (default true)
	 */
	notifyDataChanged(filePath?: string, force = false, triggerRefresh = true): void {
		// Clear cache entries for native cache manager
		if (filePath) {
			this.cacheManager.clearCacheEntry(filePath);

			// Clear task link detection cache for this file
			if (this.taskLinkDetectionService) {
				this.taskLinkDetectionService.clearCacheForFile(filePath);
			}
		} else if (force) {
			// Full cache clear if forcing
			this.cacheManager.clearAllCaches();

			// Clear task link detection cache completely
			if (this.taskLinkDetectionService) {
				this.taskLinkDetectionService.clearCache();
			}
		}

		// Only emit refresh event if triggerRefresh is true
		if (triggerRefresh) {
			// Use requestAnimationFrame for better UI timing instead of setTimeout
			requestAnimationFrame(() => {
				this.emitter.trigger(EVENT_DATA_CHANGED);
			});
		}
	}

	/**
	 * Set up date change detection to refresh task states when the date rolls over
	 */
	private setupDateChangeDetection(): void {
		// Check for date changes every minute
		const checkDateChange = () => {
			const currentDate = new Date().toDateString();
			if (currentDate !== this.lastKnownDate) {
				this.lastKnownDate = currentDate;
				// Emit date change event to trigger UI refresh
				this.emitter.trigger(EVENT_DATE_CHANGED);
			}
		};

		// Set up regular interval to check for date changes
		this.dateCheckInterval = window.setInterval(checkDateChange, 60000); // Check every minute
		this.registerInterval(this.dateCheckInterval);

		// Schedule precise check at next midnight for better timing
		this.scheduleNextMidnightCheck();
	}

	/**
	 * Schedule a precise check at the next midnight
	 */
	private scheduleNextMidnightCheck(): void {
		const now = new Date();
		const midnight = new Date(now);
		midnight.setHours(24, 0, 0, 0); // Next midnight

		const msUntilMidnight = midnight.getTime() - now.getTime();

		// Clear any existing midnight timeout
		if (this.midnightTimeout) {
			window.clearTimeout(this.midnightTimeout);
		}

		this.midnightTimeout = window.setTimeout(() => {
			// Force immediate date change check at midnight
			const currentDate = new Date().toDateString();
			if (currentDate !== this.lastKnownDate) {
				this.lastKnownDate = currentDate;
				this.emitter.trigger(EVENT_DATE_CHANGED);
			}

			// Schedule the next midnight check
			this.scheduleNextMidnightCheck();
		}, msUntilMidnight);

		// Register the timeout for cleanup
		this.registerInterval(this.midnightTimeout);
	}

	onunload() {
		// Unregister Bases views
		if (this.settings?.enableBases) {
			import("./bases/registration").then(({ unregisterBasesViews }) => {
				unregisterBasesViews(this);
				this.basesRegistered = false;
			}).catch(e => {
				console.debug("[Taskly][Bases] Unregistration failed:", e);
			});
		}

		// Clean up performance monitoring
		const cacheStats = perfMonitor.getStats("cache-initialization");
		if (cacheStats && cacheStats.count > 0) {
			perfMonitor.logSummary();
		}

		// Clean up FilterService
		if (this.filterService) {
			this.filterService.cleanup();
		}

		// Clean up ViewPerformanceService
		if (this.viewPerformanceService) {
			this.viewPerformanceService.destroy();
		}

		// Clean up task card reading mode handlers
		// Clean up AutoArchiveService
		if (this.autoArchiveService) {
			this.autoArchiveService.stop();
		}

		// Clean up TaskLinkDetectionService
		if (this.taskLinkDetectionService) {
			this.taskLinkDetectionService.cleanup();
		}

		// Stop HTTP API server
		if (this.apiService) {
			this.apiService.stop();
		}

		// Clean up ViewStateManager
		if (this.viewStateManager) {
			this.viewStateManager.cleanup();
		}

		// Clean up notification service
		if (this.notificationService) {
			this.notificationService.destroy();
		}

		// Clean up task manager
		if (this.cacheManager) {
			this.cacheManager.destroy();
		}

		// Clean up DOM reconciler
		if (this.domReconciler) {
			this.domReconciler.destroy();
		}

		// Clean up UI state manager
		if (this.uiStateManager) {
			this.uiStateManager.destroy();
		}

		// Clean up performance monitor
		if (typeof perfMonitor !== "undefined") {
			perfMonitor.destroy();
		}

		// Clean up task update listener for editor
		if (this.taskUpdateListenerForEditor) {
			this.emitter.offref(this.taskUpdateListenerForEditor);
		}

		// Clean up the event emitter (native Events class)
		if (this.emitter && typeof this.emitter.off === "function") {
			// Native Events cleanup happens automatically
		}

		// Reset initialization flag for potential reload
		this.initializationComplete = false;
	}

	async loadSettings() {
		const loadedData = await this.loadData();

		// Deep merge settings with defaults for nested objects
		this.settings = {
			...DEFAULT_SETTINGS,
			...loadedData,
			// Deep merge field mapping to ensure new fields get default values
			fieldMapping: {
				...DEFAULT_SETTINGS.fieldMapping,
				...(loadedData?.fieldMapping || {}),
			},
			// Deep merge task creation defaults to ensure new fields get default values
			taskCreationDefaults: {
				...DEFAULT_SETTINGS.taskCreationDefaults,
				...(loadedData?.taskCreationDefaults || {}),
			},
			// Deep merge command file mapping to ensure new commands get defaults
			commandFileMapping: {
				...DEFAULT_SETTINGS.commandFileMapping,
				...(loadedData?.commandFileMapping || {}),
			},
			// Deep merge NLP triggers to ensure new triggers get defaults
			nlpTriggers: {
				...DEFAULT_SETTINGS.nlpTriggers,
				...(loadedData?.nlpTriggers || {}),
				triggers: loadedData?.nlpTriggers?.triggers || DEFAULT_SETTINGS.nlpTriggers.triggers,
			},
			// Array handling - maintain existing arrays or use defaults
			customStatuses: loadedData?.customStatuses || DEFAULT_SETTINGS.customStatuses,
		};

		// Check if we added any new field mappings or command mappings and save if needed
		const hasNewFields = Object.keys(DEFAULT_SETTINGS.fieldMapping).some(
			(key) => !loadedData?.fieldMapping?.[key]
		);
		const hasNewCommandMappings = Object.keys(DEFAULT_SETTINGS.commandFileMapping).some(
			(key) => !loadedData?.commandFileMapping?.[key]
		);

		if (hasNewFields || hasNewCommandMappings) {
			// Save the migrated settings to include new field mappings (non-blocking)
			setTimeout(async () => {
				try {
					const data = (await this.loadData()) || {};
					// Merge only settings properties, preserving non-settings data
					const settingsKeys = Object.keys(
						DEFAULT_SETTINGS
					) as (keyof TasklySettings)[];
					for (const key of settingsKeys) {
						data[key] = this.settings[key];
					}
					await this.saveData(data);
				} catch (error) {
					console.error("Failed to save migrated settings:", error);
				}
			}, 100);
		}

		// Cache setting migration is no longer needed (native cache only)

		// Capture initial cache settings for change detection
		this.updatePreviousCacheSettings();
	}

	async saveSettings() {
		// Load existing plugin data to preserve non-settings data
		const data = (await this.loadData()) || {};
		// Merge only settings properties, preserving non-settings data
		const settingsKeys = Object.keys(DEFAULT_SETTINGS) as (keyof TasklySettings)[];
		for (const key of settingsKeys) {
			data[key] = this.settings[key];
		}
		await this.saveData(data);

		// Check if cache-related settings have changed
		const cacheSettingsChanged = this.haveCacheSettingsChanged();


		// Update customization services with new settings
		if (this.fieldMapper) {
			this.fieldMapper.updateMapping(this.settings.fieldMapping);
		}
		if (this.statusManager) {
			this.statusManager.updateStatuses(this.settings.customStatuses);
		}

		// Only update cache manager if cache-related settings actually changed
		if (cacheSettingsChanged) {
			console.debug("Cache-related settings changed, updating cache configuration");
			this.cacheManager.updateConfig(this.settings);

			// Update our tracking of cache settings
			this.updatePreviousCacheSettings();
		}

		// Update custom styles
		this.injectCustomStyles();

		// Invalidate filter options cache so new settings (e.g., user fields) appear immediately
		this.filterService?.refreshFilterOptions();

		// If settings have changed, notify views to refresh their data
		this.notifyDataChanged();

		// Emit settings-changed event for specific settings updates
		this.emitter.trigger("settings-changed", this.settings);
	}

	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();

		// Update all services with new settings
		this.fieldMapper?.updateMapping(this.settings.fieldMapping);
		this.statusManager?.updateStatuses(this.settings.customStatuses);

		// External changes may include cache settings - update unconditionally
		this.cacheManager.updateConfig(this.settings);
		this.updatePreviousCacheSettings();

		// Update UI
		this.injectCustomStyles();
		this.filterService?.refreshFilterOptions();

		// Notify views
		this.notifyDataChanged();
		this.emitter.trigger("settings-changed", this.settings);
	}

	addCommands() {
		this.commandDefinitions = [
			{
				id: "open-table-view",
				name: "Open table view",
				callback: async () => {
					await this.openBasesFileForCommand('open-table-view');
				},
			},
			{
				id: "create-new-task",
				name: "Create new task",
				hotkeys: [
					{
						modifiers: ["Mod"],
						key: "j",
					},
				],
				callback: () => {
					this.openTaskCreationModal();
				},
			},
			{
				id: "convert-current-note-to-task",
				name: "Convert current note to task",
				callback: async () => {
					await this.convertCurrentNoteToTask();
				},
			},
			{
				id: "convert-to-taskly-note",
				name: "Convert checkbox task to Taskly note",
				editorCallback: async (editor: Editor) => {
					await this.convertTaskToTasklyNote(editor);
				},
			},
			{
				id: "batch-convert-all-tasks",
				name: "Convert all tasks in note",
				editorCallback: async (editor: Editor) => {
					await this.batchConvertAllTasks(editor);
				},
			},
			{
				id: "insert-taskly-note-link",
				name: "Insert Taskly note link",
				editorCallback: (editor: Editor) => {
					this.insertTasklyNoteLink(editor);
				},
			},
			{
				id: "create-inline-task",
				name: "Create new inline task",
				editorCallback: async (editor: Editor) => {
					await this.createInlineTask(editor);
				},
			},
			{
				id: "quick-actions-current-task",
				name: "Quick actions for current task",
				callback: async () => {
					await this.openQuickActionsForCurrentTask();
				},
			},
			{
				id: "go-to-today",
				name: "Go to today's note",
				callback: async () => {
					await this.navigateToCurrentDailyNote();
				},
			},
			{
				id: "refresh-cache",
				name: "Refresh cache",
				callback: async () => {
					await this.refreshCache();
				},
			},
			{
				id: "create-or-open-task",
				name: "Create or open task",
				callback: async () => {
					await this.openTaskSelectorWithCreate();
				},
			},
		];

		this.registerCommands();
	}

	private registerCommands(): void {
		this.registeredCommands.clear();
		for (const definition of this.commandDefinitions) {
			const commandConfig: Command = {
				id: definition.id,
				name: definition.name,
			};
			if (definition.callback) {
				commandConfig.callback = () => {
					void definition.callback?.();
				};
			}
			if (definition.editorCallback) {
				commandConfig.editorCallback = (editor: Editor, view: MarkdownView) => {
					void definition.editorCallback?.(editor, view);
				};
			}
			if (definition.checkCallback) {
				commandConfig.checkCallback = definition.checkCallback;
			}
			if (definition.hotkeys) {
				commandConfig.hotkeys = definition.hotkeys;
			}
			const registered = this.addCommand(commandConfig);
			this.registeredCommands.set(definition.id, registered.id);
		}
	}

	// Helper method to create or activate a view of specific type
	async activateView(viewType: string) {
		const { workspace } = this.app;

		// Use existing view if it exists
		let leaf = this.getLeafOfType(viewType);

		if (!leaf) {
			// Simple approach - create a new tab
			// This is more reliable for tab behavior
			leaf = workspace.getLeaf("tab");

			// Set the view state for this leaf
			await leaf.setViewState({
				type: viewType,
				active: true,
			});
		}

		// Make this leaf active and ensure it's visible
		workspace.setActiveLeaf(leaf, { focus: true });
		workspace.revealLeaf(leaf);

		return leaf;
	}

	/**
	 * Open a .base file for a command, showing an error if the file doesn't exist
	 * v4: Commands now route to Bases files instead of native views
	 */
	async openBasesFileForCommand(commandId: string): Promise<void> {
		const filePath = this.settings.commandFileMapping[commandId];

		if (!filePath) {
			new Notice(`No file configured for command: ${commandId}`);
			return;
		}

		// Normalize the path for Obsidian
		const normalizedPath = normalizePath(filePath);

		// Check if file exists
		const fileExists = await this.app.vault.adapter.exists(normalizedPath);

		if (!fileExists) {
			// Show error - user needs to configure a valid file
			new Notice(
				`File not found: ${normalizedPath}\n\nPlease configure a valid file in Settings → Taskly → View Commands.`,
				10000
			);
			return;
		}

		// Open the .base file
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!file) {
			new Notice(`File not found in vault: ${normalizedPath}\n\nThe file exists but Obsidian cannot find it. Try reloading the vault.`);
			return;
		}
		if (!(file instanceof TFile)) {
			new Notice(`Path is not a file: ${normalizedPath}`);
			return;
		}

		const leaf = this.app.workspace.getLeaf();
		await leaf.openFile(file);
	}

	/**
	 * Create default .base files in _taskly/views/ directory
	 * Called from settings UI
	 */
	async createDefaultBasesFiles(): Promise<void> {
		const { created, skipped } = await this.ensureBasesViewFiles();

		if (created.length > 0) {
			new Notice(
				`Created ${created.length} default Bases file(s):\n${created.join('\n')}`,
				8000
			);
		}

		if (skipped.length > 0 && created.length === 0) {
			new Notice(
				`Default Bases files already exist:\n${skipped.join('\n')}`,
				8000
			);
		}
	}

	private async ensureFolderHierarchy(folderPath: string): Promise<void> {
		if (!folderPath) {
			return;
		}

		const normalized = normalizePath(folderPath);
		const adapter = this.app.vault.adapter;
		const segments = normalized.split("/").filter((segment) => segment.length > 0);

		if (segments.length === 0) {
			return;
		}

		let currentPath = "";
		for (const segment of segments) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;

			// eslint-disable-next-line no-await-in-loop
			if (await adapter.exists(currentPath)) {
				continue;
			}

			try {
				// eslint-disable-next-line no-await-in-loop
				await this.app.vault.createFolder(currentPath);
			} catch (error) {
				// eslint-disable-next-line no-await-in-loop
				if (!(await adapter.exists(currentPath))) {
					throw error;
				}
			}
		}
	}

	private async ensureBasesViewFiles(): Promise<{ created: string[]; skipped: string[] }> {
		const created: string[] = [];
		const skipped: string[] = [];

		try {
			const adapter = this.app.vault.adapter;
			const commandFileMapping = {
				...DEFAULT_SETTINGS.commandFileMapping,
				...(this.settings.commandFileMapping ?? {}),
			};
			this.settings.commandFileMapping = commandFileMapping;
			const entries = Object.entries(commandFileMapping);

			for (const [commandId, rawPath] of entries) {
				if (!rawPath) {
					continue;
				}

				const normalizedPath = normalizePath(rawPath);
				// eslint-disable-next-line no-await-in-loop
				if (await adapter.exists(normalizedPath)) {
					skipped.push(rawPath);
					continue;
				}

				// Generate template with user settings
				const template = generateBasesFileTemplate(commandId, this);
				if (!template) {
					skipped.push(rawPath);
					continue;
				}

				// Only create folder hierarchy if we're actually creating the file
				const lastSlashIndex = normalizedPath.lastIndexOf("/");
				const directory = lastSlashIndex >= 0 ? normalizedPath.substring(0, lastSlashIndex) : "";

				if (directory) {
					// eslint-disable-next-line no-await-in-loop
					await this.ensureFolderHierarchy(directory);
				}

				// eslint-disable-next-line no-await-in-loop
				await this.app.vault.create(normalizedPath, template);
				created.push(rawPath);
			}
		} catch (error) {
			console.warn("[Taskly][Bases] Failed to ensure Bases command files:", error);
		}

		return { created, skipped };
	}

	/**
	 * Open and activate the search pane with a tag query
	 * (Renamed from openSearchPaneWithTag for cleaner API)
	 */
	async openTagsPane(tag: string): Promise<boolean> {
		const { workspace } = this.app;

		try {
			// Try to find existing search view first
			let searchLeaf = workspace.getLeavesOfType("search").first();

			if (!searchLeaf) {
				// Try to create/activate the search view in left sidebar
				const leftLeaf = workspace.getLeftLeaf(false);

				if (!leftLeaf) {
					console.warn("Could not get left leaf for search pane");
					return false;
				}

				try {
					await leftLeaf.setViewState({
						type: "search",
						active: true,
					});
					searchLeaf = leftLeaf;
				} catch (error) {
					console.warn("Failed to create search view:", error);
					return false;
				}
			}

			// Ensure we have a valid search leaf
			if (!searchLeaf || !searchLeaf.view) {
				console.warn("No search leaf available");
				return false;
			}

			// Set the search query to "tag:#tagname"
			const searchQuery = `tag:${tag}`;
			const searchView = searchLeaf.view as any;

			// Try different methods to set the search query based on Obsidian version
			if (typeof searchView.setQuery === "function") {
				// Newer Obsidian versions
				searchView.setQuery(searchQuery);
			} else if (typeof searchView.searchComponent?.setValue === "function") {
				// Alternative method
				searchView.searchComponent.setValue(searchQuery);
			} else if (searchView.searchInputEl) {
				// Fallback: set the input value directly
				searchView.searchInputEl.value = searchQuery;
				// Trigger search if possible
				if (typeof searchView.startSearch === "function") {
					searchView.startSearch();
				}
			} else {
				console.warn("[Taskly] Could not find method to set search query");
				new Notice("Search pane opened but could not set tag query");
				return false;
			}

			// Reveal and focus the search pane
			workspace.revealLeaf(searchLeaf);
			workspace.setActiveLeaf(searchLeaf, { focus: true });

			return true;
		} catch (error) {
			console.error("[Taskly] Error opening search pane with tag:", error);
			new Notice(`Failed to open search pane for tag: ${tag}`);
			return false;
		}
	}

	getLeafOfType(viewType: string): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(viewType);
		// Find the first leaf with an actually loaded view (not deferred)
		for (const leaf of leaves) {
			if (leaf.view && leaf.view.getViewType() === viewType) {
				return leaf;
			}
		}
		// If no loaded view found, return the first leaf (might be deferred)
		return leaves.length > 0 ? leaves[0] : null;
	}

	async navigateToCurrentDailyNote() {
		// Fix for issue #1223: Use getTodayLocal() to get the correct local calendar date
		// instead of new Date() which would be incorrectly converted by convertUTCToLocalCalendarDate()
		const date = getTodayLocal();
		await this.navigateToDailyNote(date, { isAlreadyLocal: true });
	}

	async navigateToDailyNote(date: Date, options?: { isAlreadyLocal?: boolean }) {
		try {
			// Check if Daily Notes plugin is enabled
			if (!appHasDailyNotesPluginLoaded()) {
				new Notice(
					"Daily Notes core plugin is not enabled. Please enable it in Settings > Core plugins."
				);
				return;
			}

			// Convert date to moment for the API
			// Fix for issue #857: Convert UTC-anchored date to local calendar date
			// before passing to moment() to ensure correct day is used
			// Fix for issue #1223: Skip conversion if the date is already local (e.g., from getTodayLocal())
			const localDate = options?.isAlreadyLocal ? date : convertUTCToLocalCalendarDate(date);
			const moment = (window as Window & { moment: (date: Date) => any }).moment(localDate);

			// Get all daily notes to check if one exists for this date
			const allDailyNotes = getAllDailyNotes();
			let dailyNote = getDailyNote(moment, allDailyNotes);
			let noteWasCreated = false;

			// If no daily note exists for this date, create one
			if (!dailyNote) {
				try {
					dailyNote = await createDailyNote(moment);
					noteWasCreated = true;
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					console.error("Failed to create daily note:", error);
					new Notice(`Failed to create daily note: ${errorMessage}`);
					return;
				}
			}

			// Open the daily note
			if (dailyNote) {
				await this.app.workspace.getLeaf(false).openFile(dailyNote);

				// If we created a new daily note, refresh the cache to ensure it shows up in views
				if (noteWasCreated) {
					// Note: Cache rebuilding happens automatically on data change notification

					// Notify views that data has changed to trigger a UI refresh
					this.notifyDataChanged(dailyNote.path, false, true);
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Failed to navigate to daily note:", error);
			new Notice(`Failed to navigate to daily note: ${errorMessage}`);
		}
	}

	/**
	 * Inject dynamic CSS for custom statuses
	 */
	private injectCustomStyles(): void {
		// Remove existing custom styles
		const existingStyle = document.getElementById("taskly-custom-styles");
		if (existingStyle) {
			existingStyle.remove();
		}

		// Generate new styles
		const statusStyles = this.statusManager.getStatusStyles();

		// Create style element
		const styleEl = document.createElement("style");
		styleEl.id = "taskly-custom-styles";
		styleEl.textContent = `
		${statusStyles}
	`;

		// Inject into document head
		document.head.appendChild(styleEl);
	}

	async updateTaskProperty(
		task: TaskInfo,
		property: keyof TaskInfo,
		value: TaskInfo[keyof TaskInfo],
		options: { silent?: boolean } = {}
	): Promise<TaskInfo> {
		try {
			const updatedTask = await this.taskService.updateProperty(
				task,
				property,
				value,
				options
			);

			// Provide user feedback unless silent
			if (!options.silent) {
				if (property === "status") {
					const statusValue = typeof value === "string" ? value : String(value);
					const statusConfig = this.statusManager.getStatusConfig(statusValue);
					new Notice(`Task marked as '${statusConfig?.label || statusValue}'`);
				} else {
					new Notice(`Task ${property} updated`);
				}
			}

			return updatedTask;
		} catch (error) {
			console.error(`Failed to update task ${property}:`, error);
			new Notice(`Failed to update task ${property}`);
			throw error;
		}
	}

	/**
	 * Toggles a recurring task's completion status for the selected date
	 */
	async toggleRecurringTaskComplete(task: TaskInfo, date?: Date): Promise<TaskInfo> {
		try {
			// Let TaskService handle the date logic (defaults to local today, not selectedDate)
			const updatedTask = await this.taskService.toggleRecurringTaskComplete(task, date);

			// For notification, determine the actual completion date from the task
			// Use local today if no explicit date provided
			const targetDate =
				date ||
				(() => {
					const todayLocal = getTodayLocal();
					return createUTCDateFromLocalCalendarDate(todayLocal);
				})();

			const dateStr = formatDateForStorage(targetDate);
			const wasCompleted = updatedTask.complete_instances?.includes(dateStr);
			const action = wasCompleted ? "completed" : "marked incomplete";

			// Format date for display: convert UTC-anchored date back to local display
			const displayDate = parseDateToLocal(dateStr);
			new Notice(`Recurring task ${action} for ${format(displayDate, "MMM d")}`);
			return updatedTask;
		} catch (error) {
			console.error("Failed to toggle recurring task completion:", error);
			new Notice("Failed to update recurring task");
			throw error;
		}
	}

	async toggleTaskArchive(task: TaskInfo): Promise<TaskInfo> {
		try {
			const updatedTask = await this.taskService.toggleArchive(task);
			const action = updatedTask.archived ? "archived" : "unarchived";
			new Notice(`Task ${action}`);
			return updatedTask;
		} catch (error) {
			console.error("Failed to toggle task archive:", error);
			new Notice("Failed to update task archive status");
			throw error;
		}
	}

	async toggleTaskStatus(task: TaskInfo): Promise<TaskInfo> {
		try {
			const updatedTask = await this.taskService.toggleStatus(task);
			const statusConfig = this.statusManager.getStatusConfig(updatedTask.status);
			new Notice(`Task marked as '${statusConfig?.label || updatedTask.status}'`);
			return updatedTask;
		} catch (error) {
			console.error("Failed to toggle task status:", error);
			new Notice("Failed to update task status");
			throw error;
		}
	}

	openTaskCreationModal(prePopulatedValues?: Partial<TaskInfo>) {
		new TaskCreationModal(this.app, this, { prePopulatedValues }).open();
	}

	/**
	 * Convert the current note to a task by adding required task frontmatter.
	 */
	async convertCurrentNoteToTask(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active file to convert");
			return;
		}

		// Check if this note is already a task
		const existingTask = await this.cacheManager.getTaskInfo(activeFile.path);
		if (existingTask) {
			new Notice("This note is already a task");
			return;
		}

		const now = getCurrentTimestamp();
		const fm = this.fieldMapper;

		await this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
			// Ensure core fields
			const statusField = fm.toUserField("status");
			const createdField = fm.toUserField("dateCreated");
			const modifiedField = fm.toUserField("dateModified");
			const titleField = fm.toUserField("title");

			if (frontmatter[statusField] === undefined || frontmatter[statusField] === null) {
				// Write as boolean: completed status → true, otherwise → false
				frontmatter[statusField] = this.statusManager.isCompletedStatus(this.settings.defaultTaskStatus);
			}
			if (!frontmatter[createdField]) {
				frontmatter[createdField] = now;
			}
			frontmatter[modifiedField] = now;

			if (!this.settings.storeTitleInFilename) {
				if (!frontmatter[titleField]) {
					frontmatter[titleField] = activeFile.basename;
				}
			}

			// Apply task identification
			if (this.settings.taskIdentificationMethod === "tag") {
				let tags: string[] = [];
				if (Array.isArray(frontmatter.tags)) {
					tags = frontmatter.tags.filter((tag: any) => typeof tag === "string");
				} else if (typeof frontmatter.tags === "string") {
					tags = frontmatter.tags
						.split(",")
						.map((tag: string) => tag.trim())
						.filter((tag: string) => tag.length > 0)
						.map((tag: string) => (tag.startsWith("#") ? tag.slice(1) : tag));
				}

				if (!tags.includes(this.settings.taskTag)) {
					tags.push(this.settings.taskTag);
				}
				frontmatter.tags = tags;
			} else {
				const propName = this.settings.taskPropertyName;
				const propValue = this.settings.taskPropertyValue;
				if (propName && propValue) {
					const lower = propValue.toLowerCase();
					const coercedValue =
						lower === "true" || lower === "false" ? lower === "true" : propValue;
					frontmatter[propName] = coercedValue as any;
				}
			}
		});

		new Notice(
			formatString("Converted '{title}' to a task", {
				title: activeFile.basename,
			})
		);
	}

	/**
	 * Open the task selector with create modal.
	 * This modal allows users to either select an existing task or create a new one via NLP.
	 */
	async openTaskSelectorWithCreate(): Promise<void> {
		const { openTaskSelectorWithCreate } = await import("./modals/TaskSelectorWithCreateModal");
		const result = await openTaskSelectorWithCreate(this);

		if (result.type === "selected" || result.type === "created") {
			// Open the selected/created task
			const file = this.app.vault.getAbstractFileByPath(result.task.path);
			if (file instanceof TFile) {
				await this.app.workspace.getLeaf(false).openFile(file);
			}
		}
	}

	/**
	 * Check if a recurring task is completed for a specific date
	 */
	isRecurringTaskCompleteForDate(task: TaskInfo, date: Date): boolean {
		if (!task.recurrence) return false;
		const dateStr = formatDateForStorage(date);
		const completeInstances = Array.isArray(task.complete_instances)
			? task.complete_instances
			: [];
		return completeInstances.includes(dateStr);
	}

	/**
	 * Formats time in minutes to a readable string
	 */
	formatTime(minutes: number): string {
		return formatTime(minutes);
	}

	/**
	 * Opens a simple due date modal (placeholder for now)
	 */
	async openDueDateModal(task: TaskInfo) {
		try {
			const { DueDateModal } = await import("./modals/DueDateModal");
			const modal = new DueDateModal(this.app, task, this);
			modal.open();
		} catch (error) {
			console.error("Error loading DueDateModal:", error);
		}
	}

	/**
	 * Refreshes the Taskly cache by clearing all cached data and re-initializing
	 */
	async refreshCache(): Promise<void> {
		try {
			// Show loading notice
			const loadingNotice = new Notice("Refreshing Taskly cache...", 0);

			// Clear all caches
			await this.cacheManager.clearAllCaches();

			// Notify all views to refresh
			this.notifyDataChanged(undefined, true, true);

			// Hide loading notice and show success
			loadingNotice.hide();
			new Notice("Taskly cache refreshed successfully");
		} catch (error) {
			console.error("Error refreshing cache:", error);
			new Notice("Failed to refresh cache. Please try again.");
		}
	}

	/**
	 * Convert any checkbox task on current line to Taskly task
	 * Supports multi-line selection where additional lines become task details
	 */
	async convertTaskToTasklyNote(editor: Editor): Promise<void> {
		try {
			const cursor = editor.getCursor();

			// Check if instant convert service is available
			if (!this.instantTaskConvertService) {
				new Notice("Task conversion service not available. Please try again.");
				return;
			}

			// Use the instant convert service for immediate conversion without modal
			await this.instantTaskConvertService.instantConvertTask(editor, cursor.line);
		} catch (error) {
			console.error("Error converting task:", error);
			new Notice("Failed to convert task. Please try again.");
		}
	}

	/**
	 * Batch convert all checkbox tasks in the current note to Taskly
	 */
	async batchConvertAllTasks(editor: Editor): Promise<void> {
		try {
			// Check if instant convert service is available
			if (!this.instantTaskConvertService) {
				new Notice("Task conversion service not available. Please try again.");
				return;
			}

			// Use the instant convert service for batch conversion
			await this.instantTaskConvertService.batchConvertAllTasks(editor);
		} catch (error) {
			console.error("Error batch converting tasks:", error);
			new Notice("Failed to batch convert tasks. Please try again.");
		}
	}

	/**
	 * Insert a wikilink to a selected Taskly note at the current cursor position
	 */
	async insertTasklyNoteLink(editor: Editor): Promise<void> {
		try {
			// Get all tasks
			const allTasks = await this.cacheManager.getAllTasks();
			const unarchivedTasks = allTasks.filter((task) => !task.archived);

			// Open task selector modal
			openTaskSelector(this, unarchivedTasks, (selectedTask) => {
				if (selectedTask) {
					// Create link using Obsidian's generateMarkdownLink (respects user's link format settings)
					const file = this.app.vault.getAbstractFileByPath(selectedTask.path);
					if (file) {
						const currentFile = this.app.workspace.getActiveFile();
						const sourcePath = currentFile?.path || "";
						const properLink = this.app.fileManager.generateMarkdownLink(
							file as TFile,
							sourcePath,
							"",
							selectedTask.title // Use task title as alias
						);

						// Insert at cursor position
						const cursor = editor.getCursor();
						editor.replaceRange(properLink, cursor);

						// Move cursor to end of inserted text
						const newCursor = {
							line: cursor.line,
							ch: cursor.ch + properLink.length,
						};
						editor.setCursor(newCursor);
					} else {
						new Notice("Failed to create link - file not found");
					}
				}
			});
		} catch (error) {
			console.error("Error inserting Taskly note link:", error);
			new Notice("Failed to insert Taskly note link");
		}
	}

	/**
	 * Extract selection information for command usage
	 */
	private extractSelectionInfoForCommand(
		editor: Editor,
		lineNumber: number
	): {
		taskLine: string;
		details: string;
		startLine: number;
		endLine: number;
		originalContent: string[];
	} {
		const selection = editor.getSelection();

		// If there's a selection, use it; otherwise just use the current line
		if (selection && selection.trim()) {
			const selectionRange = editor.listSelections()[0];
			const startLine = Math.min(selectionRange.anchor.line, selectionRange.head.line);
			const endLine = Math.max(selectionRange.anchor.line, selectionRange.head.line);

			// Extract all lines in the selection
			const selectedLines: string[] = [];
			for (let i = startLine; i <= endLine; i++) {
				selectedLines.push(editor.getLine(i));
			}

			// First line should be the task, rest become details
			const taskLine = selectedLines[0];
			const detailLines = selectedLines.slice(1);
			// Join without trimming to preserve indentation, but remove trailing whitespace only
			const details = detailLines.join("\n").trimEnd();

			return {
				taskLine,
				details,
				startLine,
				endLine,
				originalContent: selectedLines,
			};
		} else {
			// No selection, just use the current line
			const taskLine = editor.getLine(lineNumber);
			return {
				taskLine,
				details: "",
				startLine: lineNumber,
				endLine: lineNumber,
				originalContent: [taskLine],
			};
		}
	}

	/**
	 * Open Quick Actions for the currently active Taskly note
	 */
	async openQuickActionsForCurrentTask(): Promise<void> {
		try {
			// Get currently active file
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				new Notice("No file is currently open");
				return;
			}

			// Check if it's a Taskly note
			const taskInfo = await this.cacheManager.getTaskInfo(activeFile.path);
			if (!taskInfo) {
				new Notice("Current file is not a Taskly note");
				return;
			}

			// Open TaskActionPaletteModal with detected task
			const { TaskActionPaletteModal } = await import("./modals/TaskActionPaletteModal");
			// Use fresh UTC-anchored "today" for recurring task handling
			const now = new Date();
			const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
			const modal = new TaskActionPaletteModal(this.app, taskInfo, this, today);
			modal.open();
		} catch (error) {
			console.error("Error opening quick actions:", error);
			new Notice("Failed to open quick actions");
		}
	}

	/**
	 * Create a new inline task at cursor position
	 * Opens the task creation modal, then inserts a link to the created task
	 * Handles two scenarios:
	 * 1. Cursor on blank line: add new inline task
	 * 2. Cursor anywhere else: start new line then create inline task
	 */
	async createInlineTask(editor: Editor): Promise<void> {
		try {
			const cursor = editor.getCursor();
			const currentLine = editor.getLine(cursor.line);
			const lineContent = currentLine.trim();

			// Determine insertion point
			let insertionPoint: { line: number; ch: number };

			// Scenario 1: Cursor on blank line
			if (lineContent === "") {
				insertionPoint = { line: cursor.line, ch: cursor.ch };
			}
			// Scenario 2: Cursor anywhere else - create new line
			else {
				// Insert a new line and position cursor there
				const endOfLine = { line: cursor.line, ch: currentLine.length };
				editor.replaceRange("\n", endOfLine);
				insertionPoint = { line: cursor.line + 1, ch: 0 };
			}

			// Store the insertion context for the callback
			const insertionContext = {
				editor,
				insertionPoint,
			};

			// Open task creation modal with callback to insert link
			// Use modal-inline-creation context for inline folder behavior (Issue #1424)
			const modal = new TaskCreationModal(this.app, this, {
				prePopulatedValues: undefined,
				onTaskCreated: (task: TaskInfo) => {
					this.handleInlineTaskCreated(task, insertionContext);
				},
				creationContext: "modal-inline-creation",
			});

			modal.open();
		} catch (error) {
			console.error("Error creating inline task:", error);
			new Notice("Failed to create inline task");
		}
	}

	/**
	 * Handle task creation completion - insert link at the determined position
	 */
	private handleInlineTaskCreated(
		task: TaskInfo,
		context: {
			editor: Editor;
			insertionPoint: { line: number; ch: number };
		}
	): void {
		try {
			const { editor, insertionPoint } = context;

			// Create link using Obsidian's generateMarkdownLink
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!file) {
				new Notice("Failed to create link - file not found");
				return;
			}

			const currentFile = this.app.workspace.getActiveFile();
			const sourcePath = currentFile?.path || "";
			const properLink = this.app.fileManager.generateMarkdownLink(
				file as TFile,
				sourcePath,
				"",
				task.title // Use task title as alias
			);

			// Insert the link at the determined insertion point
			editor.replaceRange(properLink, insertionPoint);

			// Position cursor at end of inserted link
			const newCursor = {
				line: insertionPoint.line,
				ch: insertionPoint.ch + properLink.length,
			};
			editor.setCursor(newCursor);

			new Notice(`Inline task "${task.title}" created and linked successfully`);
		} catch (error) {
			console.error("Error handling inline task creation:", error);
			new Notice("Failed to insert task link");
		}
	}

	/**
	 * Check if cache-related settings have changed since last save
	 */
	private haveCacheSettingsChanged(): boolean {
		if (!this.previousCacheSettings) {
			return true; // First time, assume changed
		}

		const current = {
			taskTag: this.settings.taskTag,
			excludedFolders: this.settings.excludedFolders,
			storeTitleInFilename: this.settings.storeTitleInFilename,
			fieldMapping: this.settings.fieldMapping,
		};

		return (
			current.taskTag !== this.previousCacheSettings.taskTag ||
			current.excludedFolders !== this.previousCacheSettings.excludedFolders ||
			current.storeTitleInFilename !== this.previousCacheSettings.storeTitleInFilename ||
			JSON.stringify(current.fieldMapping) !==
				JSON.stringify(this.previousCacheSettings.fieldMapping)
		);
	}

	/**
	 * Update tracking of cache-related settings
	 */
	private updatePreviousCacheSettings(): void {
		this.previousCacheSettings = {
			taskTag: this.settings.taskTag,
			excludedFolders: this.settings.excludedFolders,
			storeTitleInFilename: this.settings.storeTitleInFilename,
			fieldMapping: JSON.parse(JSON.stringify(this.settings.fieldMapping)), // Deep copy
		};
	}
}
