import { App, Notice, setIcon } from "obsidian";
import TasklyPlugin from "../main";
import { TaskModal } from "./TaskModal";
import { TaskInfo, TaskCreationData } from "../types";
import { combineDateAndTime, getCurrentTimestamp } from "../utils/dateUtils";
import { generateTaskFilename, FilenameContext } from "../utils/filenameGenerator";
import { calculateDefaultDate, sanitizeTags } from "../utils/helpers";
import {
	NaturalLanguageParser,
	ParsedTaskData as NLParsedTaskData,
} from "../services/NaturalLanguageParser";
import { EmbeddableMarkdownEditor } from "../editor/EmbeddableMarkdownEditor";
import { createNLPAutocomplete } from "../editor/NLPCodeMirrorAutocomplete";

import { formatString } from "../utils/stringFormat";
export interface TaskCreationOptions {
	prePopulatedValues?: Partial<TaskInfo>;
	onTaskCreated?: (task: TaskInfo) => void;
	creationContext?: "manual-creation" | "modal-inline-creation"; // Folder behavior context
}

export class TaskCreationModal extends TaskModal {
	private options: TaskCreationOptions;
	private nlParser: NaturalLanguageParser;
	private nlInput: HTMLTextAreaElement; // Legacy - keeping for compatibility
	private nlMarkdownEditor: EmbeddableMarkdownEditor | null = null;
	private nlPreviewContainer: HTMLElement;
	private nlButtonContainer: HTMLElement;
	private titleEnterListenerAttached = false;

	// Track event listeners for cleanup
	private eventListeners: Array<{
		element: HTMLElement | HTMLTextAreaElement;
		event: string;
		handler: EventListener;
	}> = [];

	constructor(
		app: App,
		plugin: TasklyPlugin,
		options: TaskCreationOptions = {}
	) {
		super(app, plugin);
		this.options = options;
		this.nlParser = NaturalLanguageParser.fromPlugin(plugin);
	}

	getModalTitle(): string {
		return "Create task";
	}

	protected isCreationMode(): boolean {
		return true;
	}

	/**
	 * Add an event listener and track it for cleanup
	 */
	private addTrackedEventListener(
		element: HTMLElement | HTMLTextAreaElement,
		event: string,
		handler: EventListener
	): void {
		element.addEventListener(event, handler);
		this.eventListeners.push({ element, event, handler });
	}

	/**
	 * Remove all tracked event listeners
	 */
	private removeAllEventListeners(): void {
		for (const { element, event, handler } of this.eventListeners) {
			element.removeEventListener(event, handler);
		}
		this.eventListeners = [];
	}

	/**
	 * Override to use NLP input as the primary input.
	 */
	protected createPrimaryInput(container: HTMLElement): void {
		this.createNaturalLanguageInput(container);
		// Always start with the modal expanded so Details is visible
		this.isExpanded = true;
		this.containerEl.addClass("expanded");
	}

	private createNaturalLanguageInput(container: HTMLElement): void {
		const nlContainer = container.createDiv("nl-input-container");

		// Create markdown editor container
		const editorContainer = nlContainer.createDiv("nl-markdown-editor");
		editorContainer.setAttribute("role", "textbox");
		editorContainer.setAttribute("aria-label", "Buy groceries tomorrow at 3pm @home #errands");
		editorContainer.setAttribute("aria-multiline", "true");

		// Preview container
		this.nlPreviewContainer = nlContainer.createDiv("nl-preview-container");
		this.nlPreviewContainer.setAttribute("role", "status");
		this.nlPreviewContainer.setAttribute("aria-live", "polite");
		this.nlPreviewContainer.setAttribute("aria-label", "Task preview");

		try {
			// Create NLP autocomplete extension for tag/status/user field triggers
			// Returns array: [autocomplete, keymap]
			const nlpAutocomplete = createNLPAutocomplete(this.plugin);

			// Create embeddable markdown editor with autocomplete
			this.nlMarkdownEditor = new EmbeddableMarkdownEditor(this.app, editorContainer, {
				value: "",
				placeholder: "Buy groceries tomorrow at 3pm @home #errands",
				cls: "nlp-editor",
				extensions: nlpAutocomplete, // Add autocomplete extensions (array)
				enterVimInsertMode: true, // Auto-enter insert mode when vim is enabled (#1410)
				onChange: (value) => {
					// Parse and apply NLP data automatically as user types
					if (value.trim()) {
						const parsed = this.nlParser.parseInput(value.trim());
						this.applyParsedData(parsed);
						this.updateNaturalLanguagePreview(value.trim());
					} else {
						// Reset all NLP-derived fields when input is cleared
						this.title = "";
						this.dueDate = "";
						this.tags = "";
						this.details = "";
						this.recurrenceRule = "";
						this.clearNaturalLanguagePreview();
						this.updateIconStates();
					}
				},
				onSubmit: () => {
					// Ctrl+Enter - save the task
					this.handleSave();
				},
				onEscape: () => {
					// ESC - close the modal (only when not in vim insert mode)
					// Vim mode will handle its own ESC to exit insert mode
					this.close();
				},
				onTab: () => {
					// Tab - jump to details (expand form if needed)
					if (!this.isExpanded) {
						this.expandModal();
					}
					setTimeout(() => {
						this.detailsMarkdownEditor?.focus();
					}, 50);
					return true; // Prevent default tab behavior
				},
				onEnter: (editor, mod, shift) => {
					if (shift) {
						// Shift+Enter - allow newline
						return false;
					}
					if (mod) {
						// Ctrl/Cmd+Enter - save (already handled by onSubmit)
						this.handleSave();
						return true;
					}
					// Normal Enter - create task
					this.handleSave();
					return true;
				},
			});

			// Make clicking anywhere in the scroller area focus the editor
			// This is needed because cm-content doesn't fill the full height
			setTimeout(() => {
				if (this.nlMarkdownEditor?.scrollDOM) {
					this.nlMarkdownEditor.scrollDOM.addEventListener("click", (e) => {
						const target = e.target as HTMLElement;
						// Only focus if clicking on empty space (scroller itself), not on content
						if (target.classList.contains("cm-scroller")) {
							this.nlMarkdownEditor?.focus();
						}
					});
				}
			}, 50);

			// Focus the editor after a short delay and reset scroll position
			setTimeout(() => {
				if (this.nlMarkdownEditor) {
					const cm = this.nlMarkdownEditor.editor?.cm;
					if (cm && cm.dom?.isConnected) {
						cm.focus();
						// Reset scroll to top to prevent auto-scroll down
						cm.scrollDOM.scrollTop = 0;
					}
				}
			}, 100);
		} catch (error) {
			console.error("Failed to create NLP markdown editor:", error);
			// Fallback to textarea if editor creation fails
			this.nlInput = editorContainer.createEl("textarea", {
				cls: "nl-input",
				attr: {
					placeholder: "Buy groceries tomorrow at 3pm @home #errands",
					rows: "3",
				},
			});

			// Event listeners for fallback - track them for cleanup
			const inputHandler = () => {
				const input = this.nlInput.value.trim();
				if (input) {
					// Parse and apply NLP data automatically as user types
					const parsed = this.nlParser.parseInput(input);
					this.applyParsedData(parsed);
					this.updateNaturalLanguagePreview(input);
				} else {
					// Reset all NLP-derived fields when input is cleared
					this.title = "";
					this.dueDate = "";
					this.tags = "";
					this.details = "";
					this.recurrenceRule = "";
					this.clearNaturalLanguagePreview();
					this.updateIconStates();
				}
			};
			this.addTrackedEventListener(this.nlInput, "input", inputHandler);

			const keydownHandler = (e: Event) => {
				const input = this.nlInput.value.trim();
				const keyEvent = e as KeyboardEvent;
				if (keyEvent.key === "Enter" && !keyEvent.shiftKey) {
					keyEvent.preventDefault();
					this.handleSave();
				} else if (keyEvent.key === "Tab" && !keyEvent.shiftKey) {
					keyEvent.preventDefault();
					if (!this.isExpanded) {
						this.expandModal();
					}
					setTimeout(() => {
						this.detailsMarkdownEditor?.focus();
					}, 50);
				} else if (keyEvent.key === "Tab" && keyEvent.shiftKey) {
					keyEvent.preventDefault();
					if (input) {
						this.parseAndFillForm(input);
					}
				}
			};
			this.addTrackedEventListener(this.nlInput, "keydown", keydownHandler);

			setTimeout(() => {
				this.nlInput.focus();
			}, 100);
		}
	}

	private updateNaturalLanguagePreview(input: string): void {
		if (!this.nlPreviewContainer) return;

		const parsed = this.nlParser.parseInput(input);
		const previewData = this.nlParser.getPreviewData(parsed);

		// Filter out title — it's already visible in the input field
		const metadataItems = previewData.filter((item) => item.icon !== "edit-3");

		if (metadataItems.length > 0 && parsed.title) {
			this.nlPreviewContainer.empty();
			this.nlPreviewContainer.addClass("has-chips");

			metadataItems.forEach((item) => {
				const chip = this.nlPreviewContainer.createDiv("nl-preview-chip");
				const iconEl = chip.createSpan("nl-preview-chip__icon");
				setIcon(iconEl, item.icon);
				const textEl = chip.createSpan("nl-preview-chip__text");
				// Clean up verbose labels — show just the value
				textEl.textContent = item.text
					.replace(/^"(.*)"$/, "$1") // Remove quotes
					.replace(/^Date:\s*/, "")
					.replace(/^Tags:\s*/, "")
					.replace(/^Status:\s*/, "")
					.replace(/^Details:\s*"?(.*?)"?$/, "$1")
					.replace(/^Recurrence:\s*/, "");
			});
		} else {
			this.clearNaturalLanguagePreview();
		}
	}

	private clearNaturalLanguagePreview(): void {
		if (this.nlPreviewContainer) {
			this.nlPreviewContainer.removeClass("has-chips");
			// Delay emptying until transition completes to avoid content flash
			setTimeout(() => {
				if (!this.nlPreviewContainer.hasClass("has-chips")) {
					this.nlPreviewContainer.empty();
				}
			}, 200);
		}
	}

	/**
	 * Get the current NLP input value from either markdown editor or fallback textarea
	 */
	private getNLPInputValue(): string {
		if (this.nlMarkdownEditor) {
			return this.nlMarkdownEditor.value;
		} else if (this.nlInput) {
			return this.nlInput.value;
		}
		return "";
	}

	protected createActionBar(container: HTMLElement): void {
		this.actionBar = container.createDiv("action-bar");

		// Date icon
		this.createActionIcon(
			this.actionBar,
			"calendar",
			"Set date",
			(icon, event) => {
				this.showDateContextMenu(event);
			},
			"due-date"
		);

		// Status icon removed - status is set via task cards, not modal

		// Recurrence icon
		this.createActionIcon(
			this.actionBar,
			"refresh-ccw",
			"Set recurrence",
			(icon, event) => {
				this.showRecurrenceContextMenu(event);
			},
			"recurrence"
		);

		// Reminder icon
		this.createActionIcon(
			this.actionBar,
			"bell",
			"Set reminders",
			(icon, event) => {
				this.showReminderContextMenu(event);
			},
			"reminders"
		);

		// Update icon states based on current values
		this.updateIconStates();
	}

	private parseAndFillForm(input: string): void {
		const parsed = this.nlParser.parseInput(input);
		this.applyParsedData(parsed);

		// Expand the form to show filled fields
		if (!this.isExpanded) {
			this.expandModal();
		}
	}

	private applyParsedData(parsed: NLParsedTaskData): void {
		if (parsed.title) this.title = parsed.title;
		if (parsed.status) this.status = parsed.status;

		// Handle due date with time - clear when NLP no longer detects a date
		if (parsed.dueDate) {
			this.dueDate = parsed.dueTime
				? combineDateAndTime(parsed.dueDate, parsed.dueTime)
				: parsed.dueDate;
		} else {
			this.dueDate = "";
		}

		this.tags = (parsed.tags && parsed.tags.length > 0) ? sanitizeTags(parsed.tags.join(", ")) : "";
		this.details = parsed.details || "";
		this.recurrenceRule = parsed.recurrence || "";

		// Update form inputs if they exist
		if (this.titleInput) this.titleInput.value = this.title;
		if (this.detailsInput) this.detailsInput.value = this.details;
		if (this.detailsMarkdownEditor) this.detailsMarkdownEditor.setValue(this.details);
		if (this.tagsInput) this.tagsInput.value = this.tags;

		// Handle user-defined fields
		if (parsed.userFields) {
			console.debug("[TaskCreationModal] applyParsedData - parsed.userFields:", parsed.userFields);
			console.debug("[TaskCreationModal] applyParsedData - available user field definitions:", this.plugin.settings.userFields);

			for (const [fieldId, value] of Object.entries(parsed.userFields)) {
				// Find the user field definition
				const userField = this.plugin.settings.userFields?.find((f) => f.id === fieldId);
				console.debug(`[TaskCreationModal] Looking for field ${fieldId}, found:`, userField);

				if (userField) {
					// Store in userFields using the frontmatter key
					if (Array.isArray(value)) {
						this.userFields[userField.key] = value.join(", ");
					} else {
						this.userFields[userField.key] = value;
					}
					console.debug(`[TaskCreationModal] Applied user field ${userField.displayName} (key: ${userField.key}): ${value}`);
					console.debug(`[TaskCreationModal] Current this.userFields:`, this.userFields);
				} else {
					console.warn(`[TaskCreationModal] No user field definition found for field ID: ${fieldId}`);
				}
			}
		} else {
			console.debug("[TaskCreationModal] applyParsedData - NO parsed.userFields");
		}

		// Update icon states
		this.updateIconStates();
	}

	private toggleDetailedForm(): void {
		if (this.isExpanded) {
			// Collapse
			this.isExpanded = false;
			this.detailsContainer.style.display = "none";
			this.containerEl.removeClass("expanded");
		} else {
			// Expand
			this.expandModal();
		}
	}

	async initializeFormData(): Promise<void> {
		// Initialize with default values from settings
		this.status = this.plugin.settings.defaultTaskStatus;

		// Apply task creation defaults
		const defaults = this.plugin.settings.taskCreationDefaults;

		// Apply default due date
		this.dueDate = calculateDefaultDate(defaults.defaultDueDate);

		// Apply default tags
		this.tags = defaults.defaultTags || "";

		// Apply default reminders
		if (defaults.defaultReminders && defaults.defaultReminders.length > 0) {
			// Import the conversion function
			const { convertDefaultRemindersToReminders } = await import("../utils/settingsUtils");
			this.reminders = convertDefaultRemindersToReminders(defaults.defaultReminders);
		}

		// Apply default values for user-defined fields
		if (this.plugin.settings.userFields) {
			for (const field of this.plugin.settings.userFields) {
				if (field.defaultValue !== undefined) {
					// For date fields, convert preset values (today, tomorrow, next-week) to actual dates
					if (field.type === "date" && typeof field.defaultValue === "string") {
						const datePreset = field.defaultValue as "none" | "today" | "tomorrow" | "next-week";
						const calculatedDate = calculateDefaultDate(datePreset);
						if (calculatedDate) {
							this.userFields[field.key] = calculatedDate;
						}
					} else {
						this.userFields[field.key] = field.defaultValue;
					}
				}
			}
		}

		// Apply pre-populated values if provided (overrides defaults)
		if (this.options.prePopulatedValues) {
			this.applyPrePopulatedValues(this.options.prePopulatedValues);
		}

		this.details = this.normalizeDetails(this.details);
		this.originalDetails = this.details;
	}

	private applyPrePopulatedValues(values: Partial<TaskInfo>): void {
		if (values.title !== undefined) this.title = values.title;
		if (values.due !== undefined) this.dueDate = values.due;
		if (values.status !== undefined) this.status = values.status;
		if (values.tags !== undefined) {
			this.tags = sanitizeTags(
				values.tags.filter((tag) => tag !== this.plugin.settings.taskTag).join(", ")
			);
		}
		if (values.recurrence !== undefined && typeof values.recurrence === "string") {
			this.recurrenceRule = values.recurrence;
		}
		if (values.recurrence_anchor !== undefined) {
			const anchorValue = String(values.recurrence_anchor);
			this.recurrenceAnchor =
				anchorValue === "scheduled" ? "due" : (anchorValue as "due" | "completion");
		}
	}

	async handleSave(): Promise<void> {
		// If there's content in the NL field, parse it first
		const nlContent = this.getNLPInputValue().trim();
		if (nlContent && !this.title.trim()) {
			// Only auto-parse if no title has been manually entered
			const parsed = this.nlParser.parseInput(nlContent);
			this.applyParsedData(parsed);
		}

		if (!this.validateForm()) {
			new Notice("Please enter a task title");
			return;
		}

		try {
			const taskData = this.buildTaskData();
			// Disable defaults since they were already applied to form fields in initializeFormData()
			const result = await this.plugin.taskService.createTask(taskData, { applyDefaults: false });
			let createdTask = result.taskInfo;

			// Check if filename was changed due to length constraints
			const expectedFilename = result.taskInfo.title.replace(/[<>:"/\\|?*]/g, "").trim();
			const actualFilename = result.file.basename;

			if (actualFilename.startsWith("task-") && actualFilename !== expectedFilename) {
				new Notice(
					formatString("Task \"{title}\" created successfully (filename shortened due to length)",  {
						title: createdTask.title,
					})
				);
			} else {
				new Notice(
					formatString("Task \"{title}\" created successfully",  { title: createdTask.title })
				);
			}

			if (this.options.onTaskCreated) {
				this.options.onTaskCreated(createdTask);
			}

			this.close();
		} catch (error) {
			console.error("Failed to create task:", error);
			const message = error instanceof Error && error.message ? error.message : String(error);
			new Notice(formatString("Failed to create task: {message}",  { message }));
		}
	}

	private buildTaskData(): Partial<TaskInfo> {
		const now = getCurrentTimestamp();

		// Parse tags
		const tagList = sanitizeTags(this.tags)
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t.length > 0);

		// Add the task tag if using tag-based identification and it's not already present
		if (
			this.plugin.settings.taskIdentificationMethod === 'tag' &&
			this.plugin.settings.taskTag &&
			!tagList.includes(this.plugin.settings.taskTag)
		) {
			tagList.push(this.plugin.settings.taskTag);
		}

		const taskData: TaskCreationData = {
			title: this.title.trim(),
			due: this.dueDate || undefined,
			status: this.status,
			tags: tagList.length > 0 ? tagList : undefined,
			recurrence: this.recurrenceRule || undefined,
			recurrence_anchor: this.recurrenceRule ? this.recurrenceAnchor : undefined,
			reminders: this.reminders.length > 0 ? this.reminders : undefined,
			// Use provided creationContext or default to manual-creation for folder logic
			// "manual-creation" = Create New Task command -> uses default tasksFolder
			// "modal-inline-creation" = Create New Inline Task command -> uses inlineTaskConvertFolder
			creationContext: this.options.creationContext || "manual-creation",
			dateCreated: now,
			dateModified: now,
			// Add user fields as custom frontmatter properties
			customFrontmatter: this.buildCustomFrontmatter(),
		};

		// Add details if provided
		const normalizedDetails = this.normalizeDetails(this.details).trimEnd();
		if (normalizedDetails.length > 0) {
			taskData.details = normalizedDetails;
		}

		return taskData;
	}

	private buildCustomFrontmatter(): Record<string, any> {
		const customFrontmatter: Record<string, any> = {};

		console.debug("[TaskCreationModal] Building custom frontmatter from userFields:", this.userFields);

		// Add user field values to frontmatter
		for (const [fieldKey, fieldValue] of Object.entries(this.userFields)) {
			if (fieldValue !== null && fieldValue !== undefined && fieldValue !== "") {
				customFrontmatter[fieldKey] = fieldValue;
				console.debug(`[TaskCreationModal] Adding to frontmatter: ${fieldKey} = ${fieldValue}`);
			}
		}

		console.debug("[TaskCreationModal] Final custom frontmatter:", customFrontmatter);
		return customFrontmatter;
	}

	private generateFilename(taskData: TaskCreationData): string {
		const context: FilenameContext = {
			title: taskData.title || "",
			status: taskData.status || "open",
			dueDate: taskData.due,
		};

		return generateTaskFilename(context, this.plugin.settings);
	}

	protected createModalContent(): void {
		super.createModalContent();
		// Attach Enter-to-save if a title input exists (e.g., edit-only context).
		this.attachEnterToSaveOnTitle();

		// Force vertical layout for creation modal - details should always be below
		this.containerEl.removeClass("split-layout-enabled");
	}

	private attachEnterToSaveOnTitle(): void {
		if (this.titleEnterListenerAttached || !this.titleInput) {
			return;
		}
		const handler = (event: Event) => {
			const keyEvent = event as KeyboardEvent;
			if (
				keyEvent.key === "Enter" &&
				!keyEvent.shiftKey &&
				!keyEvent.ctrlKey &&
				!keyEvent.metaKey &&
				!keyEvent.altKey &&
				!keyEvent.isComposing
			) {
				keyEvent.preventDefault();
				this.handleSave();
			}
		};
		this.addTrackedEventListener(this.titleInput, "keydown", handler);
		this.titleEnterListenerAttached = true;
	}

	onClose(): void {
		// Clean up markdown editor if it exists
		if (this.nlMarkdownEditor) {
			this.nlMarkdownEditor.destroy();
			this.nlMarkdownEditor = null;
		}

		// Remove all tracked event listeners
		this.removeAllEventListeners();

		super.onClose();
	}
}
