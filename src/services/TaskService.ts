import {
	EVENT_TASK_DELETED,
	EVENT_TASK_UPDATED,
	TaskCreationData,
	TaskInfo,
} from "../types";
import { AutoArchiveService } from "./AutoArchiveService";
import {
	FilenameContext,
	generateTaskFilename,
	generateUniqueFilename,
} from "../utils/filenameGenerator";
import { Notice, TFile, normalizePath, stringifyYaml } from "obsidian";
import { TemplateData, mergeTemplateFrontmatter, processTemplate } from "../utils/templateProcessor";
import {
	addDTSTARTToRecurrenceRule,
	calculateDefaultDate,
	ensureFolderExists,
	splitFrontmatterAndBody,
	updateToNextDueOccurrence,
} from "../utils/helpers";
import { getCurrentDateString, getCurrentTimestamp } from "../utils/dateUtils";
import { format } from "date-fns";
import { processTaskFolderTemplate } from "./task/TaskFolderTemplate";
import { sanitizeTitleForFilename, sanitizeTitleForStorage } from "./task/TaskSanitize";
import { RecurringTaskService } from "./task/RecurringTaskService";

import TasklyPlugin from "../main";

import { formatString } from "../utils/stringFormat";
export class TaskService {
	private autoArchiveService?: AutoArchiveService;
	private recurringTaskService: RecurringTaskService;

	constructor(private plugin: TasklyPlugin) {
		this.recurringTaskService = new RecurringTaskService(plugin);
	}

	/**
	 * Set auto-archive service for handling automatic archiving
	 */
	setAutoArchiveService(service: AutoArchiveService): void {
		this.autoArchiveService = service;
	}


	/**
	 * Create a new task file with all the necessary setup
	 * This is the central method for task creation used by all components
	 *
	 * @param taskData - The task data to create
	 * @param options - Optional settings for task creation
	 * @param options.applyDefaults - Whether to apply task creation defaults. Set to false for imports that shouldn't have defaults applied. Defaults to true.
	 */
	async createTask(
		taskData: TaskCreationData,
		options: { applyDefaults?: boolean } = {}
	): Promise<{ file: TFile; taskInfo: TaskInfo }> {
		const { applyDefaults = true } = options;

		try {
			// Apply task creation defaults if enabled
			if (applyDefaults) {
				taskData = await this.applyTaskCreationDefaults(taskData);
			}

			// Validate required fields
			if (!taskData.title || !taskData.title.trim()) {
				throw new Error("Title is required");
			}

			// Apply defaults for missing fields and sanitize title
			// Use stricter sanitization only when title is used in filename
			const title = this.plugin.settings.storeTitleInFilename
				? sanitizeTitleForFilename(taskData.title.trim())
				: sanitizeTitleForStorage(taskData.title.trim());
			const status = taskData.status || this.plugin.settings.defaultTaskStatus;
			const dateCreated = taskData.dateCreated || getCurrentTimestamp();
			const dateModified = taskData.dateModified || getCurrentTimestamp();

			// Handle tags based on identification method
			let tagsArray = taskData.tags || [];

			// Only add task tag if using tag-based identification
			if (this.plugin.settings.taskIdentificationMethod === "tag") {
				if (!tagsArray.includes(this.plugin.settings.taskTag)) {
					tagsArray = [this.plugin.settings.taskTag, ...tagsArray];
				}
			}

			// Generate filename
			const filenameContext: FilenameContext = {
				title: title,
				status: status,
				date: new Date(),
				dueDate: taskData.due,
			};

			const baseFilename = generateTaskFilename(filenameContext, this.plugin.settings);

			// Determine folder based on creation context
			// Process folder templates with task and date variables for dynamic folder organization
			let folder = "";
			if (taskData.creationContext === "inline-conversion" || taskData.creationContext === "modal-inline-creation") {
				// For inline conversion and modal-based inline task creation, use the inline task folder setting with variable support
				const inlineFolder = this.plugin.settings.inlineTaskConvertFolder || "";
				if (inlineFolder.trim()) {
					// Inline folder is configured, use it
					folder = inlineFolder;

					// Handle currentNotePath and currentNoteTitle template variables
					if (
						inlineFolder.includes("{{currentNotePath}}") ||
						inlineFolder.includes("{{currentNoteTitle}}")
					) {
						const currentFile = this.plugin.app.workspace.getActiveFile();

						if (inlineFolder.includes("{{currentNotePath}}")) {
							// Get current file's folder path
							const currentFolderPath = currentFile?.parent?.path || "";
							folder = folder.replace(/\{\{currentNotePath\}\}/g, currentFolderPath);
						}

						if (inlineFolder.includes("{{currentNoteTitle}}")) {
							// Get current file's title (basename without extension)
							const currentNoteTitle = currentFile?.basename || "";
							folder = folder.replace(/\{\{currentNoteTitle\}\}/g, currentNoteTitle);
						}
					}
					// Process task and date variables in the inline folder path
					folder = processTaskFolderTemplate(folder, taskData);
				} else {
					// Fallback to default tasks folder when inline folder is empty (#128)
					const tasksFolder = this.plugin.settings.tasksFolder || "";
					folder = processTaskFolderTemplate(tasksFolder, taskData);
				}
			} else {
				// For manual creation and other contexts, use the general tasks folder
				const tasksFolder = this.plugin.settings.tasksFolder || "";
				folder = processTaskFolderTemplate(tasksFolder, taskData);
			}

			// Ensure folder exists
			if (folder) {
				await ensureFolderExists(this.plugin.app.vault, folder);
			}

			// Generate unique filename
			const uniqueFilename = await generateUniqueFilename(
				baseFilename,
				folder,
				this.plugin.app.vault
			);
			const fullPath = folder ? `${folder}/${uniqueFilename}.md` : `${uniqueFilename}.md`;

			// Create complete TaskInfo object with all the data
			const completeTaskData: Partial<TaskInfo> = {
				title: title,
				status: status,
				due: taskData.due || undefined,
				dateCreated: dateCreated,
				dateModified: dateModified,
				recurrence: taskData.recurrence || undefined,
				recurrence_anchor: taskData.recurrence_anchor || undefined,
				reminders:
					taskData.reminders && taskData.reminders.length > 0
						? taskData.reminders
						: undefined,
			};

			const shouldAddTaskTag = this.plugin.settings.taskIdentificationMethod === "tag";
			const taskTagForFrontmatter = shouldAddTaskTag
				? this.plugin.settings.taskTag
				: undefined;

			// Use field mapper to convert to frontmatter with proper field mapping
			const frontmatter = this.plugin.fieldMapper.mapToFrontmatter(
				completeTaskData,
				taskTagForFrontmatter,
				this.plugin.settings.storeTitleInFilename
			);

			// Handle task identification based on settings
			if (this.plugin.settings.taskIdentificationMethod === "property") {
				const propName = this.plugin.settings.taskPropertyName;
				const propValue = this.plugin.settings.taskPropertyValue;
				if (propName && propValue) {
					// Coerce boolean-like strings to actual booleans for compatibility with Obsidian properties
					const lower = propValue.toLowerCase();
					const coercedValue =
						lower === "true" || lower === "false" ? lower === "true" : propValue;
					frontmatter[propName] = coercedValue as any;
				}
				if (tagsArray.length > 0) {
					frontmatter.tags = tagsArray;
				}
			} else {
				// Tags are handled separately (not via field mapper)
				frontmatter.tags = tagsArray;
			}

			// Apply template processing (both frontmatter and body)
			const templateResult = await this.applyTemplate(taskData);
			const normalizedBody = templateResult.body
				? templateResult.body.replace(/\r\n/g, "\n").trimEnd()
				: taskData.details
					? taskData.details.replace(/\r\n/g, "\n").trimEnd()
					: "";

			// Merge template frontmatter with base frontmatter
			// User-defined values take precedence over template frontmatter
			let finalFrontmatter = mergeTemplateFrontmatter(
				frontmatter,
				templateResult.frontmatter
			);

			// Add custom frontmatter properties (including user fields)
			if (taskData.customFrontmatter) {
				finalFrontmatter = { ...finalFrontmatter, ...taskData.customFrontmatter };
			}

			// Prepare file content
			const yamlHeader = stringifyYaml(finalFrontmatter);
			let content = `---\n${yamlHeader}---\n\n`;

			if (normalizedBody.length > 0) {
				content += `${normalizedBody}\n`;
			}

			// Create the file
			const file = await this.plugin.app.vault.create(fullPath, content);

			// Create final TaskInfo object for cache and events
			// Ensure required fields are present by using the complete task data as base
			const taskInfo: TaskInfo = {
				...completeTaskData,
				...finalFrontmatter,
				// Ensure required fields are always defined
				title: finalFrontmatter.title || completeTaskData.title || title,
				status: finalFrontmatter.status || completeTaskData.status || status,
				path: file.path,
				tags: tagsArray,
				archived: false,
				details: normalizedBody,
			};

			// Wait for fresh data and update cache
			try {
				// Wait for the metadata cache to have the updated data for new tasks
				if (this.plugin.cacheManager.waitForFreshTaskData) {
					await this.plugin.cacheManager.waitForFreshTaskData(file);
				}
				this.plugin.cacheManager.updateTaskInfoInCache(file.path, taskInfo);
			} catch (cacheError) {
				console.error("Error updating cache for new task:", cacheError);
			}

			// Emit task created event
			this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
				path: file.path,
				updatedTask: taskInfo,
			});

			return { file, taskInfo };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			// eslint-disable-next-line no-console
			console.error("Error creating task:", {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
				taskData,
			});

			throw new Error(`Failed to create task: ${errorMessage}`);
		}
	}

	/**
	 * Apply template to task (both frontmatter and body) if enabled in settings
	 */
	private async applyTemplate(
		taskData: TaskCreationData
	): Promise<{ frontmatter: Record<string, any>; body: string }> {
		const defaults = this.plugin.settings.taskCreationDefaults;

		// Check if body template is enabled and configured
		if (!defaults.useBodyTemplate || !defaults.bodyTemplate?.trim()) {
			// No template configured, return empty frontmatter and details as body
			return {
				frontmatter: {},
				body: taskData.details?.trim() || "",
			};
		}

		try {
			// Normalize the template path and ensure it has .md extension
			let templatePath = normalizePath(defaults.bodyTemplate.trim());
			if (!templatePath.endsWith(".md")) {
				templatePath += ".md";
			}

			// Try to load the template file
			const templateFile = this.plugin.app.vault.getAbstractFileByPath(templatePath);
			if (templateFile instanceof TFile) {
				const templateContent = await this.plugin.app.vault.read(templateFile);

				// Prepare task data for template variables (with all final values)
				const templateTaskData: TemplateData = {
					title: taskData.title || "",
					status: taskData.status || "",
					tags: Array.isArray(taskData.tags) ? taskData.tags : [],
					dueDate: taskData.due || "",
					details: taskData.details || "",
					parentNote: taskData.parentNote || "",
				};

				// Process the complete template (frontmatter + body)
				return processTemplate(templateContent, templateTaskData);
			} else {
				// Template file not found, log error and return details as-is
				// eslint-disable-next-line no-console
				console.warn(`Task body template not found: ${templatePath}`);
				new Notice(
					formatString("Task body template not found: {path}",  { path: templatePath })
				);
				return {
					frontmatter: {},
					body: taskData.details?.trim() || "",
				};
			}
		} catch (error) {
			// Error reading template, log error and return details as-is
			console.error("Error reading task body template:", error);
			new Notice(
				formatString("Error reading task body template: {template}",  {
					template: defaults.bodyTemplate,
				})
			);
			return {
				frontmatter: {},
				body: taskData.details?.trim() || "",
			};
		}
	}

	/**
	 * Apply task creation defaults from settings to task data
	 * This includes due date, tags,
	 * recurrence, reminders, and user field defaults.
	 */
	private async applyTaskCreationDefaults(taskData: TaskCreationData): Promise<TaskCreationData> {
		const defaults = this.plugin.settings.taskCreationDefaults;
		const result = { ...taskData };

		// Apply default due date if not provided
		if (!result.due && defaults.defaultDueDate !== "none") {
			result.due = calculateDefaultDate(defaults.defaultDueDate);
		}

		// Apply default tags if not provided
		if (!result.tags && defaults.defaultTags) {
			result.tags = defaults.defaultTags
				.split(",")
				.map((t) => t.trim())
				.filter((t) => t);
		}

		// Apply default recurrence if not provided
		if (!result.recurrence && defaults.defaultRecurrence && defaults.defaultRecurrence !== "none") {
			const freqMap: Record<string, string> = {
				daily: "FREQ=DAILY",
				weekly: "FREQ=WEEKLY",
				monthly: "FREQ=MONTHLY",
				yearly: "FREQ=YEARLY",
			};
			result.recurrence = freqMap[defaults.defaultRecurrence] || undefined;
		}

		// Apply default reminders if not provided
		if (!result.reminders && defaults.defaultReminders && defaults.defaultReminders.length > 0) {
			const { convertDefaultRemindersToReminders } = await import("../utils/settingsUtils");
			result.reminders = convertDefaultRemindersToReminders(defaults.defaultReminders);
		}

		// Apply default values for user-defined fields
		const userFields = this.plugin.settings.userFields;
		if (userFields && userFields.length > 0) {
			if (!result.customFrontmatter) {
				result.customFrontmatter = {};
			}
			for (const field of userFields) {
				// Only apply default if the field isn't already set
				if (field.defaultValue !== undefined && result.customFrontmatter[field.key] === undefined) {
					// For date fields, convert preset values (today, tomorrow, next-week) to actual dates
					if (field.type === "date" && typeof field.defaultValue === "string") {
						const calculatedDate = calculateDefaultDate(
							field.defaultValue as "none" | "today" | "tomorrow" | "next-week"
						);
						if (calculatedDate) {
							result.customFrontmatter[field.key] = calculatedDate;
						}
					} else {
						result.customFrontmatter[field.key] = field.defaultValue;
					}
				}
			}
		}

		return result;
	}

	/**
	 * Toggle the status of a task between completed and open
	 */
	async toggleStatus(task: TaskInfo): Promise<TaskInfo> {
		try {
			// Determine new status
			const isCurrentlyCompleted = this.plugin.statusManager.isCompletedStatus(task.status);
			const newStatus = isCurrentlyCompleted
				? this.plugin.settings.defaultTaskStatus // Revert to default open status
				: this.plugin.statusManager.getCompletedStatuses()[0] || "done"; // Set to first completed status

			return await this.updateProperty(task, "status", newStatus);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Error toggling task status:", {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
				taskPath: task.path,
				currentStatus: task.status,
			});

			throw new Error(`Failed to toggle task status: ${errorMessage}`);
		}
	}

	/**
	 * Update a single property of a task following the deterministic data flow pattern
	 */
	async updateProperty(
		task: TaskInfo,
		property: keyof TaskInfo,
		value: any,
		options: { silent?: boolean } = {}
	): Promise<TaskInfo> {
		try {
			if (
				property === "due" ||
				property === "recurrence" ||
				property === "recurrence_anchor" ||
				property === "reminders"
			) {
				return await this.updateTask(task, {
					[property]: value,
				} as Partial<TaskInfo>);
			}

			const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				throw new Error(`Cannot find task file: ${task.path}`);
			}

			// Get fresh task data to prevent overwrites
			const freshTask = (await this.plugin.cacheManager.getTaskInfo(task.path)) || task;

			// Step 1: Construct new state in memory using fresh data
			let updatedTask = { ...freshTask } as Record<string, any>;
			updatedTask[property] = value;
			updatedTask.dateModified = getCurrentTimestamp();

			// Handle derivative changes for status updates
			if (property === "status" && !freshTask.recurrence) {
				if (this.plugin.statusManager.isCompletedStatus(value)) {
					updatedTask.completedDate = getCurrentDateString();
				} else {
					updatedTask.completedDate = undefined;
				}
			}

			// Step 2: Persist to file
			await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// Use field mapper to get the correct frontmatter property name
				const fieldName = this.plugin.fieldMapper.toUserField(
					property as keyof import("../types").FieldMapping
				);

				if (property === "status") {
					// Write as boolean: completed status → true, otherwise → false
					frontmatter[fieldName] = this.plugin.statusManager.isCompletedStatus(value);
					this.updateCompletedDateInFrontmatter(frontmatter, value, !!freshTask.recurrence);
				} else {
					frontmatter[fieldName] = value;
				}

				// Always update the modification timestamp using field mapper
				const dateModifiedField = this.plugin.fieldMapper.toUserField("dateModified");
				frontmatter[dateModifiedField] = updatedTask.dateModified;
			});

			// Step 3: Wait for fresh data and update cache
			try {
				// Wait for the metadata cache to have the updated data
				if (this.plugin.cacheManager.waitForFreshTaskData) {
					await this.plugin.cacheManager.waitForFreshTaskData(file);
				}
				this.plugin.cacheManager.updateTaskInfoInCache(
					task.path,
					updatedTask as TaskInfo
				);
			} catch (cacheError) {
				// Cache errors shouldn't break the operation, just log them
				// eslint-disable-next-line no-console
				console.error("Error updating task cache:", {
					error: cacheError instanceof Error ? cacheError.message : String(cacheError),
					taskPath: task.path,
				});
			}

			// Step 4: Notify system of change
			try {
				this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
					path: task.path,
					originalTask: task,
					updatedTask: updatedTask as TaskInfo,
				});

				// Step 5: Additional status-related side effects can be handled here if needed
			} catch (eventError) {
				// eslint-disable-next-line no-console
				console.error("Error emitting task update event:", {
					error: eventError instanceof Error ? eventError.message : String(eventError),
					taskPath: task.path,
				});
				// Event emission errors shouldn't break the operation
			}

			// If task was archived and status moves back to a non-completed state, unarchive it.
			if (
				property === "status" &&
				!this.plugin.statusManager.isCompletedStatus(value as string) &&
				(updatedTask as TaskInfo).archived
			) {
				try {
					updatedTask = await this.toggleArchive(updatedTask as TaskInfo);
				} catch (error) {
					console.warn("Failed to auto-unarchive task after status change:", error);
				}
			}

			// Handle auto-archive if status property changed
			if (this.autoArchiveService && property === "status" && value !== task.status) {
				try {
					const statusConfig = this.plugin.statusManager.getStatusConfig(value as string);
					if (statusConfig) {
						if (statusConfig.autoArchive) {
							// Schedule for auto-archive
							await this.autoArchiveService.scheduleAutoArchive(
								updatedTask as TaskInfo,
								statusConfig
							);
						} else {
							// Cancel any pending auto-archive since new status doesn't have auto-archive
							await this.autoArchiveService.cancelAutoArchive(
								(updatedTask as TaskInfo).path
							);
						}
					}
				} catch (error) {
					console.warn(
						"Failed to handle auto-archive for status property change:",
						error
					);
				}
			}

			// Step 5: Return authoritative data
			return updatedTask as TaskInfo;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			// eslint-disable-next-line no-console
			console.error("Error updating task property:", {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
				taskPath: task.path,
				property: String(property),
				value,
			});

			throw new Error(`Failed to update task property: ${errorMessage}`);
		}
	}

	/**
	 * Toggle the archive status of a task
	 */
	async toggleArchive(task: TaskInfo): Promise<TaskInfo> {
		const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot find task file: ${task.path}`);
		}

		const archiveTag = this.plugin.fieldMapper.getMapping().archiveTag;
		const isCurrentlyArchived = task.archived;

		// Step 1: Construct new state in memory
		const updatedTask = { ...task };
		updatedTask.archived = !isCurrentlyArchived;
		updatedTask.dateModified = getCurrentTimestamp();

		// Update tags array to include/exclude archive tag
		if (!updatedTask.tags) {
			updatedTask.tags = [];
		}

		if (isCurrentlyArchived) {
			// Remove archive tag
			updatedTask.tags = updatedTask.tags.filter((tag) => tag !== archiveTag);
		} else {
			// Add archive tag if not present
			if (!updatedTask.tags.includes(archiveTag)) {
				updatedTask.tags = [...updatedTask.tags, archiveTag];
			}
		}

		// Step 2: Persist to file
		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const dateModifiedField = this.plugin.fieldMapper.toUserField("dateModified");

			// Toggle archived property (note: archived is handled via tags, not as a separate field)
			if (isCurrentlyArchived) {
				// Remove archive tag from tags array if present
				if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
					frontmatter.tags = frontmatter.tags.filter((tag: string) => tag !== archiveTag);
					if (frontmatter.tags.length === 0) {
						delete frontmatter.tags;
					}
				}
			} else {
				// Add archive tag to tags array
				if (!frontmatter.tags) {
					frontmatter.tags = [];
				} else if (!Array.isArray(frontmatter.tags)) {
					frontmatter.tags = [frontmatter.tags];
				}

				if (!frontmatter.tags.includes(archiveTag)) {
					frontmatter.tags.push(archiveTag);
				}
			}

			// Always update the modification timestamp using field mapper
			frontmatter[dateModifiedField] = updatedTask.dateModified;
		});

		// Step 2.5: Move file based on archive operation and settings
		let movedFile = file;
		if (this.plugin.settings.moveArchivedTasks) {
			try {
				if (!isCurrentlyArchived && this.plugin.settings.archiveFolder?.trim()) {
					// Archiving: Move to archive folder
					const archiveFolderTemplate = this.plugin.settings.archiveFolder.trim();
					// Process template variables in archive folder path
					const archiveFolder = processTaskFolderTemplate(archiveFolderTemplate, {
						title: updatedTask.title || "",
						status: updatedTask.status,
					});

					// Ensure archive folder exists
					await ensureFolderExists(this.plugin.app.vault, archiveFolder);

					// Construct new path in archive folder
					const newPath = `${archiveFolder}/${file.name}`;

					// Check if file already exists at destination
					const existingFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
					if (existingFile) {
						throw new Error(
							`A file named "${file.name}" already exists in the archive folder "${archiveFolder}". Cannot move task to avoid overwriting existing file.`
						);
					}

					// Move the file
					await this.plugin.app.fileManager.renameFile(file, newPath);

					// Update the file reference and task path
					movedFile = this.plugin.app.vault.getAbstractFileByPath(newPath) as TFile;
					updatedTask.path = newPath;

					// Clear old cache entry and update path in task object
					this.plugin.cacheManager.clearCacheEntry(task.path);
				} else if (isCurrentlyArchived && this.plugin.settings.tasksFolder?.trim()) {
					// Unarchiving: Move to default tasks folder
					const tasksFolder = this.plugin.settings.tasksFolder.trim();

					// Ensure tasks folder exists
					await ensureFolderExists(this.plugin.app.vault, tasksFolder);

					// Construct new path in tasks folder
					const newPath = `${tasksFolder}/${file.name}`;

					// Check if file already exists at destination
					const existingFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
					if (existingFile) {
						throw new Error(
							`A file named "${file.name}" already exists in the tasks folder "${tasksFolder}". Cannot move task to avoid overwriting existing file.`
						);
					}

					// Move the file
					await this.plugin.app.fileManager.renameFile(file, newPath);

					// Update the file reference and task path
					movedFile = this.plugin.app.vault.getAbstractFileByPath(newPath) as TFile;
					updatedTask.path = newPath;

					// Clear old cache entry and update path in task object
					this.plugin.cacheManager.clearCacheEntry(task.path);
				}
			} catch (moveError) {
				// If moving fails, show error but don't break the archive operation
				const errorMessage =
					moveError instanceof Error ? moveError.message : String(moveError);
				const operation = isCurrentlyArchived ? "unarchiving" : "archiving";
				console.error(`Error moving ${operation} task:`, errorMessage);
				new Notice(
					formatString("Failed to move {operation} task: {error}",  {
						operation,
						error: errorMessage,
					})
				);
				// Continue with archive operation without moving the file
			}
		}

		// Step 3: Wait for fresh data and update cache
		try {
			// Wait for the metadata cache to have the updated data
			if (movedFile instanceof TFile && this.plugin.cacheManager.waitForFreshTaskData) {
				await this.plugin.cacheManager.waitForFreshTaskData(movedFile);
			}
			this.plugin.cacheManager.updateTaskInfoInCache(updatedTask.path, updatedTask);
		} catch (cacheError) {
			console.error("Error updating cache for archived task:", cacheError);
		}

		// Step 4: Notify system of change
		this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
			path: updatedTask.path,
			originalTask: task,
			updatedTask: updatedTask,
		});


		// Step 5: Return authoritative data
		return updatedTask;
	}

	/**
	 * Update a task with multiple property changes following the deterministic data flow pattern
	 */
	async updateTask(
		originalTask: TaskInfo,
		updates: Partial<TaskInfo> & { details?: string }
	): Promise<TaskInfo> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(originalTask.path);
			if (!(file instanceof TFile)) {
				throw new Error(`Cannot find task file: ${originalTask.path}`);
			}

			const isRenameNeeded =
				this.plugin.settings.storeTitleInFilename &&
				updates.title &&
				updates.title !== originalTask.title;
			let newPath = originalTask.path;

			if (isRenameNeeded) {
				const parentPath = file.parent ? file.parent.path : "";
				const newFilename = await generateUniqueFilename(
					updates.title!,
					parentPath,
					this.plugin.app.vault
				);
				newPath = parentPath ? `${parentPath}/${newFilename}.md` : `${newFilename}.md`;
			}

			// Check if recurrence rule changed and update due date if needed
			let recurrenceUpdates: Partial<TaskInfo> = {};
			if (
				updates.recurrence !== undefined &&
				updates.recurrence !== originalTask.recurrence
			) {
				// Recurrence rule changed, calculate new due date
				const tempTask: TaskInfo = { ...originalTask, ...updates };
				const nextDates = updateToNextDueOccurrence(tempTask);
				if (nextDates.due) {
					recurrenceUpdates.due = nextDates.due;
				}

				// Add DTSTART to recurrence rule if it's missing (scenario 1: editing recurrence rule)
				if (
					typeof updates.recurrence === "string" &&
					updates.recurrence &&
					!updates.recurrence.includes("DTSTART:")
				) {
					const tempTaskWithRecurrence: TaskInfo = {
						...originalTask,
						...updates,
						...recurrenceUpdates,
					};
					const updatedRecurrence = addDTSTARTToRecurrenceRule(tempTaskWithRecurrence);
					if (updatedRecurrence) {
						recurrenceUpdates.recurrence = updatedRecurrence;
					}
				}
			} else if (
				updates.recurrence !== undefined &&
				!originalTask.recurrence &&
				updates.recurrence
			) {
				// Scenario 2: Converting non-recurring to recurring task
				if (
					typeof updates.recurrence === "string" &&
					!updates.recurrence.includes("DTSTART:")
				) {
					const tempTask: TaskInfo = { ...originalTask, ...updates };
					const updatedRecurrence = addDTSTARTToRecurrenceRule(tempTask);
					if (updatedRecurrence) {
						recurrenceUpdates.recurrence = updatedRecurrence;
					}
				}
			}

			// Scenario 3: Due date update for recurring tasks
			if (
				updates.due !== undefined &&
				updates.due !== originalTask.due &&
				originalTask.recurrence
			) {
				if (
					typeof originalTask.recurrence === "string" &&
					!originalTask.recurrence.includes("DTSTART:")
				) {
					const tempTask: TaskInfo = { ...originalTask, ...updates };
					const updatedRecurrence = addDTSTARTToRecurrenceRule(tempTask);
					if (updatedRecurrence) {
						recurrenceUpdates.recurrence = updatedRecurrence;
					}
				}
			}

			// Step 1: Persist frontmatter changes to the file at its original path
			let normalizedDetails: string | null = null;
			if (Object.prototype.hasOwnProperty.call(updates, "details")) {
				normalizedDetails =
					typeof updates.details === "string"
						? updates.details.replace(/\r\n/g, "\n")
						: "";
			}

			await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const completeTaskData: Partial<TaskInfo> = {
					...originalTask,
					...updates,
					...recurrenceUpdates,
					dateModified: getCurrentTimestamp(),
				};

				const mappedFrontmatter = this.plugin.fieldMapper.mapToFrontmatter(
					completeTaskData,
					this.plugin.settings.taskIdentificationMethod === "tag"
						? this.plugin.settings.taskTag
						: undefined,
					this.plugin.settings.storeTitleInFilename
				);

				Object.keys(mappedFrontmatter).forEach((key) => {
					if (mappedFrontmatter[key] !== undefined) {
						frontmatter[key] = mappedFrontmatter[key];
					}
				});

				// Handle completedDate for status changes (non-recurring tasks only)
				if (updates.status !== undefined) {
					this.updateCompletedDateInFrontmatter(frontmatter, updates.status, !!originalTask.recurrence);
				}

				// Handle task identification based on settings
				if (this.plugin.settings.taskIdentificationMethod === "property") {
					const propName = this.plugin.settings.taskPropertyName;
					const propValue = this.plugin.settings.taskPropertyValue;
					if (propName && propValue) {
						// Coerce boolean-like strings to actual booleans for compatibility with Obsidian properties
						const lower = propValue.toLowerCase();
						const coercedValue =
							lower === "true" || lower === "false" ? lower === "true" : propValue;
						frontmatter[propName] = coercedValue as any;
					}
				}

				// Handle custom frontmatter properties (including user fields)
				if ((updates as any).customFrontmatter) {
					Object.keys((updates as any).customFrontmatter).forEach((key) => {
						const value = (updates as any).customFrontmatter[key];
						if (value === null) {
							// Remove the property if value is null
							delete frontmatter[key];
						} else {
							// Set the property value
							frontmatter[key] = value;
						}
					});
				}

				if (updates.hasOwnProperty("due") && updates.due === undefined)
					delete frontmatter[this.plugin.fieldMapper.toUserField("due")];
				if (updates.hasOwnProperty("completedDate") && updates.completedDate === undefined)
					delete frontmatter[this.plugin.fieldMapper.toUserField("completedDate")];
				if (updates.hasOwnProperty("recurrence") && updates.recurrence === undefined)
					delete frontmatter[this.plugin.fieldMapper.toUserField("recurrence")];
				if (updates.hasOwnProperty("reminders")) {
					const reminderField = this.plugin.fieldMapper.toUserField("reminders");
					if (!updates.reminders || updates.reminders.length === 0) {
						delete frontmatter[reminderField];
					}
				}

				if (isRenameNeeded) {
					delete frontmatter[this.plugin.fieldMapper.toUserField("title")];
				}

				if (updates.hasOwnProperty("tags")) {
					const tagsToSet = Array.isArray(updates.tags) ? [...updates.tags] : [];
					if (tagsToSet.length > 0) {
						frontmatter.tags = tagsToSet;
					} else {
						delete frontmatter.tags;
					}
				}
			});

			// Step 2: Rename the file if needed, after frontmatter is updated
			if (isRenameNeeded) {
				await this.plugin.app.fileManager.renameFile(file, newPath);
			}

			// Step 2b: Update body content if details changed
			if (normalizedDetails !== null) {
				const targetFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
				if (targetFile instanceof TFile) {
					const currentContent = await this.plugin.app.vault.read(targetFile);
					const { frontmatter: frontmatterText } =
						splitFrontmatterAndBody(currentContent);
					const frontmatterBlock =
						frontmatterText !== null ? `---\n${frontmatterText}\n---\n\n` : "";
					const bodyContent = normalizedDetails.trimEnd();
					const finalBody = bodyContent.length > 0 ? `${bodyContent}\n` : "";
					await this.plugin.app.vault.modify(
						targetFile,
						`${frontmatterBlock}${finalBody}`
					);
				}
			}

			// Step 3: Construct the final authoritative state
			let updatedTask: TaskInfo = {
				...originalTask,
				...updates,
				...recurrenceUpdates,
				path: newPath,
				dateModified: getCurrentTimestamp(),
			};

			if (normalizedDetails !== null) {
				updatedTask.details = normalizedDetails;
			}

			if (updates.status !== undefined && !originalTask.recurrence) {
				if (this.plugin.statusManager.isCompletedStatus(updates.status)) {
					if (!originalTask.completedDate) {
						updatedTask.completedDate = getCurrentDateString();
					}
				} else {
					updatedTask.completedDate = undefined;
				}
			}

			// Step 4: Wait for fresh data and update cache
			if (isRenameNeeded) {
				this.plugin.cacheManager.clearCacheEntry(originalTask.path);
			}
			try {
				// Wait for the metadata cache to have the updated data
				const finalFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
				if (finalFile instanceof TFile && this.plugin.cacheManager.waitForFreshTaskData) {
					// Wait for key changes to be reflected
					const keyChanges: Partial<TaskInfo> = {};
					if (updates.title !== undefined) keyChanges.title = updates.title;
					if (updates.status !== undefined) keyChanges.status = updates.status;
					if (Object.keys(keyChanges).length > 0) {
						await this.plugin.cacheManager.waitForFreshTaskData(finalFile);
					}
				}
				this.plugin.cacheManager.updateTaskInfoInCache(newPath, updatedTask);
			} catch (cacheError) {
				// Cache errors shouldn't break the operation, just log them
				// eslint-disable-next-line no-console
				console.error("Error updating task cache:", {
					error: cacheError instanceof Error ? cacheError.message : String(cacheError),
					taskPath: newPath,
				});
			}

			// Step 5: Notify system of change
			try {
				this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
					path: newPath,
					originalTask: originalTask,
					updatedTask: updatedTask,
				});
			} catch (eventError) {
				// eslint-disable-next-line no-console
				console.error("Error emitting task update event:", {
					error: eventError instanceof Error ? eventError.message : String(eventError),
					taskPath: newPath,
				});
				// Event emission errors shouldn't break the operation
			}


			// If task was archived and status moves back to a non-completed state, unarchive it.
			if (
				updates.status !== undefined &&
				!this.plugin.statusManager.isCompletedStatus(updatedTask.status) &&
				updatedTask.archived
			) {
				try {
					updatedTask = await this.toggleArchive(updatedTask);
				} catch (error) {
					console.warn("Failed to auto-unarchive task after status change:", error);
				}
			}

			// Handle auto-archive if status changed
			if (
				this.autoArchiveService &&
				updates.status !== undefined &&
				updates.status !== originalTask.status
			) {
				try {
					const statusConfig = this.plugin.statusManager.getStatusConfig(
						updatedTask.status
					);
					if (statusConfig) {
						if (statusConfig.autoArchive) {
							// Schedule for auto-archive
							await this.autoArchiveService.scheduleAutoArchive(
								updatedTask,
								statusConfig
							);
						} else {
							// Cancel any pending auto-archive since new status doesn't have auto-archive
							await this.autoArchiveService.cancelAutoArchive(updatedTask.path);
						}
					}
				} catch (error) {
					console.warn("Failed to handle auto-archive for status change:", error);
				}
			}

			return updatedTask;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Error updating task:", {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
				taskPath: originalTask.path,
				updates,
			});

			throw new Error(`Failed to update task: ${errorMessage}`);
		}
	}

	/**
	 * Delete a task file and remove it from all caches and indexes
	 */
	async deleteTask(task: TaskInfo): Promise<void> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				throw new Error(`Cannot find task file: ${task.path}`);
			}

			// Step 1: Delete the file from the vault
			await this.plugin.app.vault.delete(file);

			// Step 2: Remove from cache and indexes (this will be done by the file delete event)
			// But we'll also do it proactively to ensure immediate UI updates
			this.plugin.cacheManager.clearCacheEntry(task.path);

			// Step 3: Emit task deleted event
			this.plugin.emitter.trigger(EVENT_TASK_DELETED, {
				path: task.path,
				deletedTask: task,
			});

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			// eslint-disable-next-line no-console
			console.error("Error deleting task:", {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
				taskPath: task.path,
			});

			throw new Error(`Failed to delete task: ${errorMessage}`);
		}
	}

	/**
	 * Toggle completion status for recurring tasks on a specific date
	 */
	async toggleRecurringTaskComplete(task: TaskInfo, date?: Date): Promise<TaskInfo> {
		return this.recurringTaskService.toggleRecurringTaskComplete(task, date);
	}

	/**
	 * Toggle a recurring task instance as skipped for a specific date
	 * Similar to toggleRecurringTaskComplete but uses skipped_instances array
	 *
	 * When skipping:
	 * - Adds date to skipped_instances
	 * - Removes date from complete_instances (if present)
	 * - Updates due date to next uncompleted occurrence
	 *
	 * When unskipping:
	 * - Removes date from skipped_instances
	 * - Updates due date back to this date (since it's now incomplete)
	 */
	async toggleRecurringTaskSkipped(task: TaskInfo, date?: Date): Promise<TaskInfo> {
		return this.recurringTaskService.toggleRecurringTaskSkipped(task, date);
	}

	/**
	 * Update the completedDate field in frontmatter based on the task's status.
	 * For non-recurring tasks:
	 * - Sets completedDate to current date when status becomes completed
	 * - Removes completedDate when status becomes incomplete
	 * For recurring tasks, this method does nothing (they don't use completedDate).
	 *
	 * @param frontmatter - The frontmatter object to modify
	 * @param newStatus - The new status value
	 * @param isRecurring - Whether the task is recurring
	 */
	private updateCompletedDateInFrontmatter(
		frontmatter: Record<string, any>,
		newStatus: string,
		isRecurring: boolean
	): void {
		if (isRecurring) {
			return; // Recurring tasks don't use completedDate
		}

		const completedDateField = this.plugin.fieldMapper.toUserField("completedDate");

		if (this.plugin.statusManager.isCompletedStatus(newStatus)) {
			frontmatter[completedDateField] = getCurrentDateString();
		} else {
			if (frontmatter[completedDateField]) {
				delete frontmatter[completedDateField];
			}
		}
	}

}
