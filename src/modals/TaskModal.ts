import { App, Modal, Notice, Setting, setIcon, TAbstractFile, TFile, setTooltip } from "obsidian";
import TasklyPlugin from "../main";
import { DateContextMenu } from "../components/DateContextMenu";
import { StatusContextMenu } from "../components/StatusContextMenu";
import { RecurrenceContextMenu } from "../components/RecurrenceContextMenu";
import { ReminderContextMenu } from "../components/ReminderContextMenu";
import { getDatePart, getTimePart, combineDateAndTime } from "../utils/dateUtils";
import { sanitizeTags } from "../utils/helpers";
import { TaskInfo, Reminder } from "../types";
import { EmbeddableMarkdownEditor } from "../editor/EmbeddableMarkdownEditor";
import { TaskFormController } from "./taskForm/TaskFormController";
import { TagSuggest, UserFieldSuggest } from "./taskForm/TaskFormSuggest";

import { formatString } from "../utils/stringFormat";
export abstract class TaskModal extends Modal {
	plugin: TasklyPlugin;
	protected form: TaskFormController;
	private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

	// Overridden by subclasses that manage an existing task
	protected getCurrentTaskPath(): string | undefined {
		return undefined;
	}

	protected extractDetailsFromContent(content: string): string {
		return this.form.extractDetailsFromContent(content);
	}

	protected normalizeDetails(value: string): string {
		return this.form.normalizeDetails(value);
	}

	protected get title(): string {
		return this.form.title;
	}

	protected set title(value: string) {
		this.form.title = value;
	}

	protected get details(): string {
		return this.form.details;
	}

	protected set details(value: string) {
		this.form.details = value;
	}

	protected get originalDetails(): string {
		return this.form.originalDetails;
	}

	protected set originalDetails(value: string) {
		this.form.originalDetails = value;
	}

	protected get dueDate(): string {
		return this.form.dueDate;
	}

	protected set dueDate(value: string) {
		this.form.dueDate = value;
	}

	protected get status(): string {
		return this.form.status;
	}

	protected set status(value: string) {
		this.form.status = value;
	}

	protected get tags(): string {
		return this.form.tags;
	}

	protected set tags(value: string) {
		this.form.tags = value;
	}

	protected get recurrenceRule(): string {
		return this.form.recurrenceRule;
	}

	protected set recurrenceRule(value: string) {
		this.form.recurrenceRule = value;
	}

	protected get recurrenceAnchor(): "due" | "completion" {
		return this.form.recurrenceAnchor;
	}

	protected set recurrenceAnchor(value: "due" | "completion") {
		this.form.recurrenceAnchor = value;
	}

	protected get reminders(): Reminder[] {
		return this.form.reminders;
	}

	protected set reminders(value: Reminder[]) {
		this.form.reminders = value;
	}

	protected get userFields(): Record<string, any> {
		return this.form.userFields;
	}

	protected set userFields(value: Record<string, any>) {
		this.form.userFields = value;
	}

	// UI elements
	protected titleInput: HTMLInputElement;
	protected detailsInput: HTMLTextAreaElement; // Legacy - kept for compatibility
	protected detailsMarkdownEditor: EmbeddableMarkdownEditor | null = null;
	protected tagsInput: HTMLInputElement;
	protected actionBar: HTMLElement;
	protected detailsContainer: HTMLElement;
	protected isExpanded = false;

	constructor(app: App, plugin: TasklyPlugin) {
		super(app);
		this.plugin = plugin;
		this.form = new TaskFormController(plugin);
	}

	/**
	 * Get the Obsidian app instance - useful for dependency injection in tests
	 */
	protected getApp(): App {
		return this.app;
	}

	/**
	 * Get the plugin instance - useful for dependency injection in tests
	 */
	protected getPlugin(): TasklyPlugin {
		return this.plugin;
	}

	/**
	 * Get a file by path - useful for testing with mocked vault
	 */
	protected getFileByPath(path: string): TAbstractFile | null {
		return this.app.vault.getAbstractFileByPath(path);
	}

	/**
	 * Get all markdown files - useful for testing with mocked vault
	 */
	protected getMarkdownFiles(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	/**
	 * Get file cache - useful for testing with mocked metadataCache
	 */
	protected getFileCache(file: TFile): any {
		return this.app.metadataCache.getFileCache(file);
	}

	/**
	 * Resolve a link to a file - useful for testing with mocked metadataCache
	 */
	protected resolveLink(linkPath: string, sourcePath: string): TFile | null {
		return this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
	}

	protected isEditMode(): boolean {
		return false;
	}

	protected isCreationMode(): boolean {
		return false;
	}

	abstract initializeFormData(): Promise<void>;
	abstract handleSave(): Promise<void>;
	abstract getModalTitle(): string;

	onOpen() {
		this.containerEl.addClass("taskly-plugin", "minimalist-task-modal");
		this.modalEl.addClass("mod-taskly");

		// Set the modal title using the standard Obsidian approach (preserves close button)
		this.titleEl.setText(this.getModalTitle());

		// Add global keyboard shortcut handler for CMD/Ctrl+Enter
		this.keyboardHandler = (e: KeyboardEvent) => {
			if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				e.stopPropagation();
				this.handleSave();
				return;
			}
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				// Skip if event comes from a markdown editor (which has its own handler)
				const target = e.target as HTMLElement;
				if (target.closest(".cm-editor")) {
					return;
				}
				e.preventDefault();
				this.handleSave();
			}
		};
		this.containerEl.addEventListener("keydown", this.keyboardHandler);

		this.initializeFormData().then(() => {
			this.createModalContent();
			this.focusTitleInput();
		});
	}

	// Store references to split layout containers for potential reuse
	protected splitContentWrapper: HTMLElement;
	protected splitLeftColumn: HTMLElement;
	protected splitRightColumn: HTMLElement;

	protected createModalContent(): void {
		const { contentEl } = this;
		contentEl.empty();

		// Create main container
		const container = contentEl.createDiv("minimalist-modal-container");

		// Create split content wrapper at the top level for wide screen layout
		this.splitContentWrapper = container.createDiv("modal-split-content");
		this.splitLeftColumn = this.splitContentWrapper.createDiv("modal-split-left");
		this.splitRightColumn = this.splitContentWrapper.createDiv("modal-split-right");

		// Create primary input area (title or NLP) - subclasses can override
		this.createPrimaryInput(this.splitLeftColumn);

		// Create action bar with icons - goes in left column
		this.createActionBar(this.splitLeftColumn);

		// Create collapsible details section (fields in left, details editor in right)
		this.createDetailsSection(container);

		// Hook for subclasses to add additional sections to left column
		this.createAdditionalSections(this.splitLeftColumn);

		// Create save/cancel buttons - outside the split, at bottom
		this.createActionButtons(container);
	}

	/**
	 * Creates the primary input area. Override in subclasses for different behavior.
	 * Default: simple title input
	 */
	protected createPrimaryInput(container: HTMLElement): void {
		this.createTitleInput(container);
	}

	/**
	 * Hook for subclasses to add additional sections after the details section.
	 * Default: no-op
	 */
	protected createAdditionalSections(container: HTMLElement): void {
		// Override in subclasses to add extra sections
	}

	protected createTitleInput(container: HTMLElement): void {
		const titleContainer = container.createDiv("title-input-container");

		this.titleInput = titleContainer.createEl("input", {
			type: "text",
			cls: "title-input",
			placeholder: "What needs to be done?",
		});

		this.titleInput.value = this.title;
		this.titleInput.addEventListener("input", (e) => {
			this.title = (e.target as HTMLInputElement).value;
		});
		this.titleInput.addEventListener("keydown", (event) => {
			if (event.key === "Tab" && !event.shiftKey) {
				event.preventDefault();
				if (!this.isExpanded) {
					this.expandModal();
				}
				setTimeout(() => {
					if (this.detailsMarkdownEditor) {
						this.detailsMarkdownEditor.focus();
					} else if (this.detailsInput) {
						this.detailsInput.focus();
					}
				}, 0);
			}
		});
	}

	protected createActionBar(container: HTMLElement): void {
		this.actionBar = container.createDiv("action-bar");

		// Date icon
		this.createActionIcon(
			this.actionBar,
			"calendar",
			"Set date",
			(_, event) => {
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
			(_, event) => {
				this.showRecurrenceContextMenu(event);
			},
			"recurrence"
		);

		// Reminder icon
		this.createActionIcon(
			this.actionBar,
			"bell",
			"Set reminders",
			(_, event) => {
				this.showReminderContextMenu(event);
			},
			"reminders"
		);

		// Update icon states based on current values
		this.updateIconStates();
	}

	protected createActionIcon(
		container: HTMLElement,
		iconName: string,
		tooltip: string,
		onClick: (icon: HTMLElement, event: UIEvent) => void,
		dataType?: string
	): HTMLElement {
		const iconContainer = container.createDiv("action-icon");
		iconContainer.setAttribute("aria-label", tooltip);
		// Store initial tooltip for later updates but don't set title attribute
		iconContainer.setAttribute("data-initial-tooltip", tooltip);
		iconContainer.setAttribute("tabindex", "0");
		iconContainer.setAttribute("role", "button");
		// Add data attribute for easier identification
		if (dataType) {
			iconContainer.setAttribute("data-type", dataType);
		}

		// Add visual tooltip using Obsidian's setTooltip API
		setTooltip(iconContainer, tooltip, { placement: "top" });

		const icon = iconContainer.createSpan("icon");
		setIcon(icon, iconName);

		iconContainer.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick(iconContainer, event);
		});

		iconContainer.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				event.stopPropagation();
				onClick(iconContainer, event);
			}
		});

		return iconContainer;
	}

	protected createDetailsSection(container: HTMLElement): void {
		// The details container wraps the expandable fields (for hide/show animation)
		// It goes inside the left column for proper expand/collapse
		this.detailsContainer = this.splitLeftColumn
			? this.splitLeftColumn.createDiv("details-container")
			: container.createDiv("details-container");

		if (!this.isExpanded) {
			this.detailsContainer.style.display = "none";
			// Also hide the right column when collapsed
			if (this.splitRightColumn) {
				this.splitRightColumn.style.display = "none";
			}
		}

		const shouldShowTitle = true;
		const shouldShowDetails = true;

		// Title field appears in details section for edit modals only.
		// Creation modals use the NLP input as the single source of truth.
		const isEditModal = this.isEditMode();

		if (shouldShowTitle && isEditModal) {
			const titleLabel = this.detailsContainer.createDiv("detail-label");
			titleLabel.textContent = "Title";

			const titleInputDetailed = this.detailsContainer.createEl("input", {
				type: "text",
				cls: "title-input-detailed",
				placeholder: "Task title...",
			});

			titleInputDetailed.value = this.title;
			titleInputDetailed.addEventListener("input", (e) => {
				this.title = (e.target as HTMLInputElement).value;
			});

			// Store reference for modals that use this as their title input
			if (isEditModal && !this.titleInput) {
				this.titleInput = titleInputDetailed;
			}
		}

		// Details editor goes in the right column
		if (shouldShowDetails) {
			const rightColumn = this.splitRightColumn || this.detailsContainer;

			const detailsLabel = rightColumn.createDiv("detail-label");
			detailsLabel.textContent = "Details";

			// Create container for the markdown editor
			const detailsEditorContainer = rightColumn.createDiv("details-markdown-editor");

			// Create embeddable markdown editor for details using shared method
			this.detailsMarkdownEditor = this.createMarkdownEditor(detailsEditorContainer, {
				value: this.details,
				placeholder: "Add more details...",
				cls: "details-editor",
				onChange: (value) => {
					this.details = value;
				},
				onSubmit: () => {
					// Ctrl/Cmd+Enter - save the task
					this.handleSave();
				},
				onEscape: () => {
					// ESC - close the modal
					this.close();
				},
				onTab: () => {
					// Tab - jump to next input field
					this.focusNextField();
					return true; // Prevent default tab behavior
				},
			});

			// Make clicking anywhere in the scroller area focus the editor
			// This is needed because cm-content doesn't fill the full height
			setTimeout(() => {
				if (this.detailsMarkdownEditor?.scrollDOM) {
					this.detailsMarkdownEditor.scrollDOM.addEventListener("click", (e) => {
						const target = e.target as HTMLElement;
						// Only focus if clicking on empty space (scroller itself), not on content
						if (target.classList.contains("cm-scroller")) {
							this.detailsMarkdownEditor?.focus();
						}
					});
				}
			}, 50);
		}

		// Additional form fields (tags, etc.) go in the details container (left side)
		this.createAdditionalFields(this.detailsContainer);
	}

	protected createAdditionalFields(container: HTMLElement): void {
		this.createTagsField(container);
		this.createUserFields(container);
	}

	protected createTagsField(container: HTMLElement): void {
		// Skip tags field in creation mode (tags are set via #tag syntax in NLP input)
		if (this.isCreationMode()) {
			return;
		}

		new Setting(container).setName("Tags").addText((text) => {
			text.setPlaceholder("tag1, tag2")
				.setValue(this.tags)
				.onChange((value) => {
					this.tags = sanitizeTags(value);
				});

			// Store reference to input element
			this.tagsInput = text.inputEl;

			// Add autocomplete functionality
			new TagSuggest(this.app, text.inputEl, this.plugin);
		});
	}

	protected createUserFields(container: HTMLElement): void {
		const userFieldConfigs = this.plugin.settings?.userFields || [];

		// Add a section separator if there are user fields
		if (userFieldConfigs.length > 0) {
			const separator = container.createDiv({ cls: "user-fields-separator" });
			separator.createDiv({
				text: "Custom Fields",
				cls: "detail-label-section",
			});
		}

		for (const field of userFieldConfigs) {
			if (!field || !field.key || !field.displayName) continue;

			const currentValue = this.userFields[field.key] || "";

			switch (field.type) {
				case "boolean":
					new Setting(container).setName(field.displayName).addToggle((toggle) => {
						toggle
							.setValue(currentValue === true || currentValue === "true")
							.onChange((value) => {
								this.userFields[field.key] = value;
							});
					});
					break;

				case "number":
					new Setting(container).setName(field.displayName).addText((text) => {
						text.setPlaceholder("0")
							.setValue(currentValue ? String(currentValue) : "")
							.onChange((value) => {
								const numValue = parseFloat(value);
								this.userFields[field.key] = isNaN(numValue) ? null : numValue;
							});
					});
					break;

				case "date":
					new Setting(container).setName(field.displayName).addText((text) => {
						text.setPlaceholder("YYYY-MM-DD")
							.setValue(currentValue ? String(currentValue) : "")
							.onChange((value) => {
								this.userFields[field.key] = value || null;
							});
						// Add date picker button/icon next to the input
						// Ensure the input and button layout as a single row with proper sizing
						const parent = text.inputEl.parentElement as HTMLElement | null;
						if (parent) parent.addClass("tn-date-control");
						const btn = parent?.createEl("button", {
							cls: "user-field-date-picker-btn",
						});
						if (btn) {
							btn.setAttribute(
								"aria-label",
								formatString("Pick {field} date",  {
									field: field.displayName,
								})
							);
							setIcon(btn, "calendar");
							btn.addEventListener("click", (e) => {
								e.preventDefault();
								const menu = new DateContextMenu({
									currentValue: text.getValue() || undefined,
									onSelect: (value) => {
										text.setValue(value || "");
										this.userFields[field.key] = value || null;
									},
									plugin: this.plugin,
									app: this.app,
								});
								menu.showAtElement(btn);
							});
						}
					});
					break;

				case "list":
					new Setting(container).setName(field.displayName).addText((text) => {
						const displayValue = Array.isArray(currentValue)
							? currentValue.join(", ")
							: currentValue
								? String(currentValue)
								: "";

						text.setPlaceholder("item1, item2, item3")
							.setValue(displayValue)
							.onChange((value) => {
								if (!value.trim()) {
									this.userFields[field.key] = null;
								} else {
									this.userFields[field.key] = value
										.split(",")
										.map((v) => v.trim())
										.filter((v) => v);
								}
							});

						// Add autocomplete functionality
						new UserFieldSuggest(this.app, text.inputEl, this.plugin, field);
						// Remove link preview area: we only want the input value
						const oldPreview = container.querySelector(".user-field-link-preview");
						if (oldPreview) oldPreview.detach?.();
					});
					break;

				case "text":
				default:
					new Setting(container).setName(field.displayName).addText((text) => {
						text.setPlaceholder(
							formatString("Enter {field}...",  {
								field: field.displayName,
							})
						)
							.setValue(currentValue ? String(currentValue) : "")
							.onChange((value) => {
								this.userFields[field.key] = value || null;
							});

						// Add autocomplete functionality
						new UserFieldSuggest(this.app, text.inputEl, this.plugin, field);
					});
					break;
			}
		}
	}

	protected createActionButtons(container: HTMLElement): void {
		const buttonContainer = container.createDiv("modal-button-container");

		// Add "Open note" button for edit modals only
		if (this.isEditMode()) {
			const openNoteButton = buttonContainer.createEl("button", {
				cls: "open-note-button",
				text: "Open note",
			});

			openNoteButton.addEventListener("click", async () => {
				await (this as any).openTaskFile();
			});
		}

		// Save button (primary action)
		const saveButton = buttonContainer.createEl("button", {
			cls: "mod-cta",
			text: "Save",
		});

		saveButton.addEventListener("click", async () => {
			saveButton.disabled = true;
			try {
				await this.handleSave();
				this.close();
			} finally {
				saveButton.disabled = false;
			}
		});

		// Cancel button
		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});

		cancelButton.addEventListener("click", () => {
			this.close();
		});
	}

	protected expandModal(): void {
		if (this.isExpanded) return;

		this.isExpanded = true;
		this.detailsContainer.style.display = "block";
		this.containerEl.addClass("expanded");

		// Also show the right column (details editor) when expanding
		if (this.splitRightColumn) {
			this.splitRightColumn.style.display = "";
		}

		// Animate the expansion
		this.detailsContainer.style.opacity = "0";
		this.detailsContainer.style.transform = "translateY(-10px)";

		setTimeout(() => {
			this.detailsContainer.style.opacity = "1";
			this.detailsContainer.style.transform = "translateY(0)";
		}, 50);
	}

	protected showDateContextMenu(event: UIEvent): void {
		const currentValue = this.dueDate;
		const title = "Set Date";

		const menu = new DateContextMenu({
			currentValue: currentValue ? getDatePart(currentValue) : undefined,
			currentTime: currentValue ? getTimePart(currentValue) : undefined,
			title: title,
			plugin: this.plugin,
			app: this.app,
			onSelect: (value: string | null, time: string | null) => {
				if (value) {
					// Combine date and time if both are provided
					const finalValue = time ? combineDateAndTime(value, time) : value;

					this.dueDate = finalValue;
				} else {
					// Clear the date
					this.dueDate = "";
				}
				this.updateDateIconState();
			},
		});

		menu.show(event);
	}

	protected showStatusContextMenu(event: UIEvent): void {
		const menu = new StatusContextMenu({
			currentValue: this.status,
			onSelect: (value) => {
				this.status = value;
				this.updateStatusIconState();
			},
			plugin: this.plugin,
		});

		menu.show(event);
	}

	protected showRecurrenceContextMenu(event: UIEvent): void {
		const menu = new RecurrenceContextMenu({
			currentValue: this.recurrenceRule,
			currentAnchor: this.recurrenceAnchor,
			onSelect: (value, anchor) => {
				this.recurrenceRule = value || "";
				if (anchor !== undefined) {
					this.recurrenceAnchor = anchor;
				}
				this.updateRecurrenceIconState();
			},
			app: this.app,
			plugin: this.plugin,
		});

		menu.show(event);
	}

	protected showReminderContextMenu(event: UIEvent): void {
		// Create a temporary task info object for the context menu
		const tempTask: TaskInfo = {
			title: this.title,
			status: this.status,
			due: this.dueDate,
			path: "", // Will be set when saving
			archived: false,
			reminders: this.reminders,
		};

		const menu = new ReminderContextMenu(
			this.plugin,
			tempTask,
			event.target as HTMLElement,
			(updatedTask: TaskInfo) => {
				this.reminders = updatedTask.reminders || [];
				this.updateReminderIconState();
			}
		);

		menu.show(event);
	}

	protected updateDateIconState(): void {
		this.updateIconStates();
	}

	protected updateStatusIconState(): void {
		this.updateIconStates();
	}

	protected updateRecurrenceIconState(): void {
		this.updateIconStates();
	}

	protected updateReminderIconState(): void {
		this.updateIconStates();
	}

	protected getDefaultStatus(): string {
		return this.form.getDefaultStatus();
	}

	protected getRecurrenceDisplayText(): string {
		return this.form.getRecurrenceDisplayText();
	}

	protected updateIconStates(): void {
		if (!this.actionBar) return;

		// Update date icon
		const dueDateIcon = this.actionBar.querySelector('[data-type="due-date"]') as HTMLElement;
		if (dueDateIcon) {
			if (this.dueDate) {
				dueDateIcon.classList.add("has-value");
				setTooltip(
					dueDateIcon,
					formatString("Date: {value}",  { value: this.dueDate }),
					{ placement: "top" }
				);
			} else {
				dueDateIcon.classList.remove("has-value");
				setTooltip(dueDateIcon, "Set date", { placement: "top" });
			}
		}

		// Update status icon
		const statusIcon = this.actionBar.querySelector('[data-type="status"]') as HTMLElement;
		if (statusIcon) {
			// Find the status config to get the label and color
			const statusConfig = this.plugin.settings.customStatuses.find(
				(s) => s.value === this.status
			);
			const statusLabel = statusConfig ? statusConfig.label : this.status;

			if (this.status && statusConfig && statusConfig.value !== this.getDefaultStatus()) {
				statusIcon.classList.add("has-value");
				setTooltip(
					statusIcon,
					formatString("Status: {value}",  { value: statusLabel }),
					{ placement: "top" }
				);
			} else {
				statusIcon.classList.remove("has-value");
				setTooltip(statusIcon, "Set status", { placement: "top" });
			}

			// Apply status color to the icon
			const iconEl = statusIcon.querySelector(".icon") as HTMLElement;
			if (iconEl && statusConfig && statusConfig.color) {
				iconEl.style.color = statusConfig.color;
			} else if (iconEl) {
				iconEl.style.color = ""; // Reset to default
			}
		}

		// Update recurrence icon
		const recurrenceIcon = this.actionBar.querySelector(
			'[data-type="recurrence"]'
		) as HTMLElement;
		if (recurrenceIcon) {
			if (this.recurrenceRule && this.recurrenceRule.trim()) {
				recurrenceIcon.classList.add("has-value");
				setTooltip(
					recurrenceIcon,
					formatString("Recurrence: {value}",  {
						value: this.getRecurrenceDisplayText(),
					}),
					{ placement: "top" }
				);
			} else {
				recurrenceIcon.classList.remove("has-value");
				setTooltip(recurrenceIcon, "Set recurrence", {
					placement: "top",
				});
			}
		}

		// Update reminder icon
		const reminderIcon = this.actionBar.querySelector('[data-type="reminders"]') as HTMLElement;
		if (reminderIcon) {
			if (this.reminders && this.reminders.length > 0) {
				reminderIcon.classList.add("has-value");
				const count = this.reminders.length;
				const tooltip =
					count === 1
						? "1 reminder set"
						: formatString("{count} reminders set",  { count });
				setTooltip(reminderIcon, tooltip, { placement: "top" });
			} else {
				reminderIcon.classList.remove("has-value");
				setTooltip(reminderIcon, "Set reminders", {
					placement: "top",
				});
			}
		}
	}

	protected focusTitleInput(): void {
		setTimeout(() => {
			if (this.titleInput) {
				this.titleInput.focus();
				this.titleInput.select();
			}
		}, 100);
	}

	protected validateForm(): boolean {
		return this.form.validateForm();
	}

	protected focusNextField(): void {
		// Try to focus the tags input as the next field after details
		setTimeout(() => {
			if (this.tagsInput) {
				this.tagsInput.focus();
			}
		}, 50);
	}

	/**
	 * Creates an embeddable markdown editor with standard configuration and error handling
	 * @param container - The parent HTML element
	 * @param options - Editor configuration options
	 * @returns The created editor instance or null if creation fails
	 */
	protected createMarkdownEditor(
		container: HTMLElement,
		options: {
			value: string;
			placeholder: string;
			cls: string;
			onChange: (value: string) => void;
			onSubmit: () => void;
			onEscape: () => void;
			onTab: () => boolean;
			extensions?: any[];
		}
	): EmbeddableMarkdownEditor | null {
		try {
			return new EmbeddableMarkdownEditor(this.app, container, options);
		} catch (error) {
			console.error("Failed to create markdown editor:", error);

			// Create fallback textarea
			const fallbackTextarea = container.createEl("textarea", {
				cls: options.cls + "-fallback",
				placeholder: options.placeholder,
			});
			fallbackTextarea.value = options.value;
			fallbackTextarea.addEventListener("input", (e) => {
				options.onChange((e.target as HTMLTextAreaElement).value);
			});
			fallbackTextarea.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
					e.preventDefault();
					options.onSubmit();
				} else if (e.key === "Escape") {
					e.preventDefault();
					options.onEscape();
				} else if (e.key === "Tab") {
					const shouldPreventDefault = options.onTab();
					if (shouldPreventDefault) {
						e.preventDefault();
					}
				}
			});

			return null;
		}
	}

	onClose(): void {
		// Clean up keyboard handler
		if (this.keyboardHandler) {
			this.containerEl.removeEventListener("keydown", this.keyboardHandler);
			this.keyboardHandler = null;
		}

		// Clean up markdown editor if it exists
		if (this.detailsMarkdownEditor) {
			this.detailsMarkdownEditor.destroy();
			this.detailsMarkdownEditor = null;
		}
		super.onClose();
	}
}
