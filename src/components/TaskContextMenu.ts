import { Menu, Notice, TFile } from "obsidian";
import TasklyPlugin from "../main";
import { TaskInfo } from "../types";
import { formatDateForStorage } from "../utils/dateUtils";
import { ReminderModal } from "../modals/ReminderModal";
import { showConfirmationModal } from "../modals/ConfirmationModal";
import { DateContextMenu } from "./DateContextMenu";
import { RecurrenceContextMenu } from "./RecurrenceContextMenu";
import { showTextInputModal } from "../modals/TextInputModal";
import { ContextMenu } from "./ContextMenu";

import { formatString } from "../utils/stringFormat";
export interface TaskContextMenuOptions {
	task: TaskInfo;
	plugin: TasklyPlugin;
	targetDate: Date;
	onUpdate?: () => void;
}

export class TaskContextMenu {
	private menu: ContextMenu;
	private options: TaskContextMenuOptions;
	private targetDoc: Document = document;

	constructor(options: TaskContextMenuOptions) {
		this.menu = new ContextMenu();
		this.options = options;
		this.buildMenu();
	}

	private buildMenu(): void {
		const { task, plugin } = this.options;

		// Status submenu
		this.menu.addItem((item) => {
			item.setTitle("Status");
			item.setIcon("circle");

			const submenu = (item as any).setSubmenu();
			this.addStatusOptions(submenu, task, plugin);
		});

		// Add completion toggle for recurring tasks
		if (task.recurrence) {
			this.menu.addSeparator();

			const dateStr = formatDateForStorage(this.options.targetDate);
			const isCompletedForDate = task.complete_instances?.includes(dateStr) || false;

			this.menu.addItem((item) => {
				item.setTitle(
					isCompletedForDate
						? "Mark incomplete for this date"
						: "Mark complete for this date"
				);
				item.setIcon(isCompletedForDate ? "x" : "check");
				item.onClick(async () => {
					try {
						await plugin.toggleRecurringTaskComplete(task, this.options.targetDate);
						this.options.onUpdate?.();
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						console.error("Error toggling recurring task completion:", {
							error: errorMessage,
							taskPath: task.path,
						});
						new Notice(
							formatString("Failed to toggle recurring task completion: {message}",  {
								message: errorMessage,
							})
						);
					}
				});
			});

			const isSkippedForDate = task.skipped_instances?.includes(dateStr) || false;

			this.menu.addItem((item) => {
				item.setTitle(
					isSkippedForDate
						? "Unskip instance"
						: "Skip instance"
				);
				item.setIcon(isSkippedForDate ? "undo" : "x-circle");
				item.onClick(async () => {
					try {
						await plugin.taskService.toggleRecurringTaskSkipped(
							task,
							this.options.targetDate
						);
						this.options.onUpdate?.();
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						console.error("Error toggling recurring task skip:", {
							error: errorMessage,
							taskPath: task.path,
						});
						new Notice(
							formatString("Failed to toggle recurring task skip: {message}",  {
								message: errorMessage,
							})
						);
					}
				});
			});
		}

		// Due Date submenu
		this.menu.addItem((item) => {
			item.setTitle("Due date");
			item.setIcon("calendar");

			const submenu = (item as any).setSubmenu();
			this.addDateOptions(
				submenu,
				task.due,
				async (value: string | null) => {
					try {
						await plugin.updateTaskProperty(task, "due", value || undefined);
						this.options.onUpdate?.();
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						console.error("Error updating task due date:", {
							error: errorMessage,
							taskPath: task.path,
						});
						new Notice(
							formatString("Failed to update task due date: {message}",  {
								message: errorMessage,
							})
						);
					}
				},
				() => {
					plugin.openDueDateModal(task);
				}
			);
		});

		// Reminders submenu
		this.menu.addItem((item) => {
			item.setTitle("Reminders");
			item.setIcon("bell");

			const submenu = (item as any).setSubmenu();

			// Quick Add sections
			this.addQuickRemindersSection(
				submenu,
				task,
				plugin,
				"due",
				"Remind before due…"
			);

			submenu.addSeparator();

			// Manage reminders
			submenu.addItem((subItem: any) => {
				subItem.setTitle("Manage all reminders…");
				subItem.setIcon("settings");
				subItem.onClick(() => {
					const modal = new ReminderModal(plugin.app, plugin, task, async (reminders) => {
						try {
							await plugin.updateTaskProperty(
								task,
								"reminders",
								reminders.length > 0 ? reminders : undefined
							);
							this.options.onUpdate?.();
						} catch (error) {
							console.error("Error updating reminders:", error);
							new Notice("Failed to update reminders");
						}
					});
					modal.open();
				});
			});

			// Clear reminders (if any exist)
			if (task.reminders && task.reminders.length > 0) {
				submenu.addItem((subItem: any) => {
					subItem.setTitle("Clear all reminders");
					subItem.setIcon("trash");
					subItem.onClick(async () => {
						try {
							await plugin.updateTaskProperty(task, "reminders", undefined);
							this.options.onUpdate?.();
						} catch (error) {
							console.error("Error clearing reminders:", error);
							new Notice("Failed to clear reminders");
						}
					});
				});
			}
		});

		this.menu.addSeparator();
		// Archive/Unarchive
		this.menu.addItem((item) => {
			item.setTitle(
				task.archived
					? "Unarchive"
					: "Archive"
			);
			item.setIcon(task.archived ? "archive-restore" : "archive");
			item.onClick(async () => {
				try {
					await plugin.toggleTaskArchive(task);
					this.options.onUpdate?.();
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					console.error("Error toggling task archive:", {
						error: errorMessage,
						taskPath: task.path,
					});
					new Notice(
						formatString("Failed to toggle task archive: {message}",  {
							message: errorMessage,
						})
					);
				}
			});
		});

		// Delete task
		this.menu.addItem((item) => {
			item.setTitle("Delete task");
			item.setIcon("trash");
			item.onClick(async () => {
				const confirmed = await showConfirmationModal(plugin.app, {
					title: "Delete Task",
					message: formatString('Are you sure you want to delete "{name}"?',  {
						name: task.title,
					}),
					confirmText: "Delete",
					cancelText: "Cancel",
					isDestructive: true,
				});
				if (!confirmed) {
					return;
				}

				try {
					await plugin.taskService.deleteTask(task);
					this.options.onUpdate?.();
					new Notice("Task deleted successfully");
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					console.error("Error deleting task:", error);
					new Notice(`Failed to delete task: ${errorMessage}`);
				}
			});
		});

		this.menu.addSeparator();

		// Open Note
		this.menu.addItem((item) => {
			item.setTitle("Open note");
			item.setIcon("file-text");
			item.onClick(() => {
				const file = plugin.app.vault.getAbstractFileByPath(task.path);
				if (file instanceof TFile) {
					const leaf = plugin.app.workspace.getLeaf("split", "vertical");
					leaf.openFile(file);
				}
			});
		});

		// Copy Task Title
		this.menu.addItem((item) => {
			item.setTitle("Copy task title");
			item.setIcon("copy");
			item.onClick(async () => {
				try {
					await navigator.clipboard.writeText(task.title);
					new Notice("Task title copied to clipboard");
				} catch (error) {
					new Notice("Failed to copy to clipboard");
				}
			});
		});

		// Note actions submenu
		this.menu.addItem((item) => {
			item.setTitle("Note actions");
			item.setIcon("file-text");

			const submenu = (item as any).setSubmenu();

			// Get the file for the task
			const file = plugin.app.vault.getAbstractFileByPath(task.path);
			if (file instanceof TFile) {
				// Try to populate with Obsidian's native file menu
				try {
					// Trigger the file-menu event to populate with default actions
					plugin.app.workspace.trigger("file-menu", submenu, file, "file-explorer");
				} catch (error) {
					console.debug("Native file menu not available, using fallback");
				}

				// Add common file actions (these will either supplement or replace the native menu)
				submenu.addItem((subItem: any) => {
					subItem.setTitle("Rename");
					subItem.setIcon("pencil");
					subItem.onClick(async () => {
						try {
							// Modal-based rename
							const currentName = file.basename;
							const newName = await showTextInputModal(plugin.app, {
								title: "Rename File",
								placeholder: "Enter new name",
								initialValue: currentName,
							});

							if (newName && newName.trim() !== "" && newName !== currentName) {
								// Ensure the new name has the correct extension
								const extension = file.extension;
								const finalName = newName.endsWith(`.${extension}`)
									? newName
									: `${newName}.${extension}`;

								// Construct the new path
								const newPath = file.parent
									? `${file.parent.path}/${finalName}`
									: finalName;

								// Rename the file
								await plugin.app.vault.rename(file, newPath);
								new Notice(
									formatString("Renamed to \"{name}\"",  {
										name: finalName,
									})
								);

								// Trigger update callback
								if (this.options.onUpdate) {
									this.options.onUpdate();
								}
							}
						} catch (error) {
							console.error("Error renaming file:", error);
							new Notice("Failed to rename file");
						}
					});
				});

				submenu.addItem((subItem: any) => {
					subItem.setTitle("Delete");
					subItem.setIcon("trash");
					subItem.onClick(async () => {
						// Show confirmation and delete
						const confirmed = await showConfirmationModal(plugin.app, {
							title: "Delete File",
							message: formatString("Are you sure you want to delete \"{name}\"?",  { name: file.name }),
							confirmText: "Delete",
							cancelText: "Cancel",
							isDestructive: true,
						});
						if (confirmed) {
							plugin.app.vault.trash(file, true);
						}
					});
				});

				submenu.addSeparator();

				submenu.addItem((subItem: any) => {
					subItem.setTitle("Copy path");
					subItem.setIcon("copy");
					subItem.onClick(async () => {
						try {
							await navigator.clipboard.writeText(file.path);
							new Notice("File path copied to clipboard");
						} catch (error) {
							new Notice("Failed to copy to clipboard");
						}
					});
				});

				submenu.addItem((subItem: any) => {
					subItem.setTitle("Copy Obsidian URL");
					subItem.setIcon("link");
					subItem.onClick(async () => {
						try {
							const url = `obsidian://open?vault=${encodeURIComponent(plugin.app.vault.getName())}&file=${encodeURIComponent(file.path)}`;
							await navigator.clipboard.writeText(url);
							new Notice("Obsidian URL copied to clipboard");
						} catch (error) {
							new Notice("Failed to copy to clipboard");
						}
					});
				});

				submenu.addSeparator();

				submenu.addItem((subItem: any) => {
					subItem.setTitle("Show in file explorer");
					subItem.setIcon("folder-open");
					subItem.onClick(() => {
						// Reveal file in file explorer
						plugin.app.workspace
							.getLeaf()
							.setViewState({
								type: "file-explorer",
								state: {},
							})
							.then(() => {
								// Focus the file in the explorer
								const fileExplorer =
									plugin.app.workspace.getLeavesOfType("file-explorer")[0];
								if (fileExplorer?.view && "revealInFolder" in fileExplorer.view) {
									(fileExplorer.view as any).revealInFolder(file);
								}
							});
					});
				});
			}
		});

		this.menu.addSeparator();

		// Recurrence submenu
		this.menu.addItem((item) => {
			item.setTitle("Recurrence");
			item.setIcon("refresh-ccw");

			const submenu = (item as any).setSubmenu();
			const currentRecurrence =
				typeof task.recurrence === "string" ? task.recurrence : undefined;
			this.addRecurrenceOptions(
				submenu,
				currentRecurrence,
				async (value: string | null) => {
					try {
						await plugin.updateTaskProperty(task, "recurrence", value || undefined);
						this.options.onUpdate?.();
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						console.error("Error updating task recurrence:", {
							error: errorMessage,
							taskPath: task.path,
						});
						new Notice(
							formatString("Failed to update task recurrence: {message}",  {
								message: errorMessage,
							})
						);
					}
				},
				plugin
			);
		});

		// Apply main menu icon colors after menu is built
		setTimeout(() => {
			this.updateMainMenuIconColors(task, plugin);
		}, 10);
	}

	private updateMainMenuIconColors(task: TaskInfo, plugin: TasklyPlugin): void {
		const menuEl = this.targetDoc.querySelector(".menu");
		if (!menuEl) return;

		const menuItems = menuEl.querySelectorAll(".menu-item");
		const statusTitle = "Status";

		// Find status menu items and apply colors
		menuItems.forEach((menuItem: Element) => {
			const titleEl = menuItem.querySelector(".menu-item-title");
			const iconEl = menuItem.querySelector(".menu-item-icon");

			if (titleEl && iconEl) {
				const title = titleEl.textContent;

				// Apply status color
				if (title === statusTitle) {
					const statusConfig = plugin.settings.customStatuses.find(
						(s) => s.value === task.status
					);
					if (statusConfig && statusConfig.color) {
						(iconEl as HTMLElement).style.color = statusConfig.color;
					}
				}
			}
		});
	}

	private addStatusOptions(submenu: any, task: TaskInfo, plugin: TasklyPlugin): void {
		const statusOptions = this.getStatusOptions(task, plugin);

		statusOptions.forEach((option, index) => {
			submenu.addItem((item: any) => {
				let title = option.label;

				// Use custom icon if configured, otherwise default to circle
				item.setIcon(option.icon || "circle");

				// Highlight current selection with visual indicator
				if (option.value === task.status) {
					title = formatString("✓ {label}",  { label: option.label });
				}

				item.setTitle(title);

				item.onClick(async () => {
					try {
						await plugin.updateTaskProperty(task, "status", option.value);
						this.options.onUpdate?.();
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						console.error("Error updating task status:", {
							error: errorMessage,
							taskPath: task.path,
						});
						new Notice(`Failed to update task status: ${errorMessage}`);
					}
				});

				// Apply color directly to this item
				if (option.color) {
					setTimeout(() => {
						const itemEl = item.dom || item.domEl;
						if (itemEl) {
							const iconEl = itemEl.querySelector(".menu-item-icon");
							if (iconEl) {
								(iconEl as HTMLElement).style.color = option.color;
							}
						}
					}, 10);
				}
			});
		});
	}

	private addDateOptions(
		submenu: any,
		currentValue: string | undefined,
		onSelect: (value: string | null) => Promise<void>,
		onCustomDate: () => void
	): void {
		const dateContextMenu = new DateContextMenu({
			currentValue: currentValue,
			onSelect: (value: string | null) => {
				onSelect(value);
			},
			onCustomDate: onCustomDate,
			plugin: this.options.plugin,
			app: this.options.plugin.app,
		});

		const dateOptions = dateContextMenu.getDateOptions();

		const incrementOptions = dateOptions.filter(
			(option: any) => option.category === "increment"
		);
		if (incrementOptions.length > 0) {
			incrementOptions.forEach((option: any) => {
				submenu.addItem((item: any) => {
					if (option.icon) item.setIcon(option.icon);
					item.setTitle(option.label);
					item.onClick(() => onSelect(option.value));
				});
			});
			submenu.addSeparator();
		}

		const basicOptions = dateOptions.filter((option: any) => option.category === "basic");
		basicOptions.forEach((option: any) => {
			submenu.addItem((item: any) => {
				if (option.icon) item.setIcon(option.icon);
				const isSelected = option.value === currentValue;
				const title = isSelected
					? formatString("✓ {label}",  { label: option.label })
					: option.label;
				item.setTitle(title);
				item.onClick(() => onSelect(option.value));
			});
		});

		const weekdayOptions = dateOptions.filter((option: any) => option.category === "weekday");
		if (weekdayOptions.length > 0) {
			submenu.addSeparator();
			submenu.addItem((item: any) => {
				item.setTitle("Weekdays");
				item.setIcon("calendar");
				const weekdaySubmenu = (item as any).setSubmenu();
				weekdayOptions.forEach((option: any) => {
					weekdaySubmenu.addItem((subItem: any) => {
						const isSelected = option.value === currentValue;
						const title = isSelected
							? formatString("✓ {label}",  { label: option.label })
							: option.label;
						subItem.setTitle(title);
						subItem.setIcon("calendar");
						subItem.onClick(() => onSelect(option.value));
					});
				});
			});
		}

		submenu.addSeparator();

		submenu.addItem((item: any) => {
			item.setTitle("Pick date & time…");
			item.setIcon("calendar");
			item.onClick(() => onCustomDate());
		});

		if (currentValue) {
			submenu.addItem((item: any) => {
				item.setTitle("Clear date");
				item.setIcon("x");
				item.onClick(() => onSelect(null));
			});
		}
	}

	private addRecurrenceOptions(
		submenu: any,
		currentValue: string | undefined,
		onSelect: (value: string | null) => Promise<void>,
		plugin: TasklyPlugin
	): void {
		const today = new Date();
		const dayNames = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
		const monthNames = [
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December",
		];
		const currentDay = dayNames[today.getDay()];
		const currentDate = today.getDate();
		const currentMonth = today.getMonth() + 1;
		const currentMonthName = monthNames[today.getMonth()];
		const dayName = today.toLocaleDateString("en-US", { weekday: "long" });

		const formatDateForDTSTART = (date: Date): string => {
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const day = String(date.getDate()).padStart(2, "0");
			return `${year}${month}${day}`;
		};

		const getOrdinal = (n: number): string => {
			const s = ["th", "st", "nd", "rd"];
			const v = n % 100;
			return n + (s[(v - 20) % 10] || s[v] || s[0]);
		};

		let todayDTSTART = formatDateForDTSTART(today);

		const recurrenceOptions = [
			{
				label: "Daily",
				value: `DTSTART:${todayDTSTART};FREQ=DAILY;INTERVAL=1`,
				icon: "calendar-days",
			},
			{
				label: formatString("Weekly on {days}",  { days: dayName }),
				value: `DTSTART:${todayDTSTART};FREQ=WEEKLY;INTERVAL=1;BYDAY=${currentDay}`,
				icon: "calendar",
			},
			{
				label: "Every 2 weeks",
				value: `DTSTART:${todayDTSTART};FREQ=WEEKLY;INTERVAL=2;BYDAY=${currentDay}`,
				icon: "calendar",
			},
			{
				label: formatString("Monthly on the {ordinal}",  {
					ordinal: getOrdinal(currentDate),
				}),
				value: `DTSTART:${todayDTSTART};FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${currentDate}`,
				icon: "calendar-range",
			},
			{
				label: "Every 3 months",
				value: `DTSTART:${todayDTSTART};FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${currentDate}`,
				icon: "calendar-range",
			},
			{
				label: formatString("Yearly on {month} {day}",  {
					month: currentMonthName,
					day: getOrdinal(currentDate),
				}),
				value: `DTSTART:${todayDTSTART};FREQ=YEARLY;INTERVAL=1;BYMONTH=${currentMonth};BYMONTHDAY=${currentDate}`,
				icon: "calendar-clock",
			},
			{
				label: "Weekdays",
				value: `DTSTART:${todayDTSTART};FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`,
				icon: "briefcase",
			},
		];

		recurrenceOptions.forEach((option) => {
			submenu.addItem((item: any) => {
				const isSelected = option.value === currentValue;
				item.setTitle(isSelected ? `✓ ${option.label}` : option.label);
				item.setIcon(option.icon);
				item.onClick(() => {
					onSelect(option.value);
				});
			});
		});

		submenu.addSeparator();

		// Custom recurrence option
		submenu.addItem((item: any) => {
			item.setTitle("Custom recurrence...");
			item.setIcon("settings");
			item.onClick(() => {
				const recurrenceMenu = new RecurrenceContextMenu({
					currentValue: typeof currentValue === "string" ? currentValue : undefined,
					currentAnchor: this.options.task.recurrence_anchor || 'due',
					onSelect: onSelect,
					app: plugin.app,
					plugin: plugin,
				});
				recurrenceMenu["showCustomRecurrenceModal"]();
			});
		});

		// Clear option if there's a current value
		if (currentValue) {
			submenu.addItem((item: any) => {
				item.setTitle("Clear recurrence");
				item.setIcon("x");
				item.onClick(() => {
					onSelect(null);
				});
			});
		}
	}

	private getStatusOptions(task: TaskInfo, plugin: TasklyPlugin) {
		const statusConfigs = plugin.settings.customStatuses;
		const statusOptions: any[] = [];

		// Use only the user-defined statuses from settings
		if (statusConfigs && statusConfigs.length > 0) {
			// Sort by order property
			const sortedStatuses = [...statusConfigs].sort((a, b) => a.order - b.order);

			// Show all statuses for all tasks (including recurring tasks)
			sortedStatuses.forEach((status) => {
				statusOptions.push({
					label: status.label,
					value: status.value,
					color: status.color,
					icon: status.icon,
				});
			});
		}

		return statusOptions;
	}

	private addQuickRemindersSection(
		submenu: any,
		task: TaskInfo,
		plugin: TasklyPlugin,
		anchor: "due",
		title: string
	): void {
		const anchorDate = task.due;

		if (!anchorDate) {
			// If no anchor date, show disabled option
			submenu.addItem((subItem: any) => {
				subItem.setTitle(title);
				subItem.setIcon("bell");
				subItem.setDisabled(true);
			});
			return;
		}

		// Add submenu for quick reminder options
		submenu.addItem((subItem: any) => {
			subItem.setTitle(title);
			subItem.setIcon("bell");

			const reminderSubmenu = (subItem as any).setSubmenu();

			const quickOptions = [
				{ label: "At time of event", offset: "PT0M" },
				{ label: "5 minutes before", offset: "-PT5M" },
				{ label: "15 minutes before", offset: "-PT15M" },
				{ label: "1 hour before", offset: "-PT1H" },
				{ label: "1 day before", offset: "-P1D" },
			];

			quickOptions.forEach((option) => {
				reminderSubmenu.addItem((reminderItem: any) => {
					reminderItem.setTitle(option.label);
					reminderItem.onClick(async () => {
						await this.addQuickReminder(task, plugin, anchor, option.offset, option.label);
					});
				});
			});
		});
	}

	private async addQuickReminder(
		task: TaskInfo,
		plugin: TasklyPlugin,
		anchor: "due",
		offset: string,
		description: string
	): Promise<void> {
		const reminder = {
			id: `rem_${Date.now()}`,
			type: "relative" as const,
			relatedTo: anchor,
			offset,
			description,
		};

		const updatedReminders = [...(task.reminders || []), reminder];
		try {
			await plugin.updateTaskProperty(task, "reminders", updatedReminders);
			this.options.onUpdate?.();
		} catch (error) {
			console.error("Error adding reminder:", error);
			new Notice("Failed to add reminder");
		}
	}

	public show(event: MouseEvent): void {
		// Store the document reference from the event target to support pop-out windows
		// Use cross-window compatible instanceOf check
		if ((event.target as Node)?.instanceOf?.(HTMLElement)) {
			this.targetDoc = (event.target as HTMLElement).ownerDocument;
		}
		this.menu.showAtMouseEvent(event);
	}

	public showAtElement(element: HTMLElement): void {
		// Store the document reference from the element to support pop-out windows
		this.targetDoc = element.ownerDocument;
		this.menu.showAtPosition({
			x: element.getBoundingClientRect().left,
			y: element.getBoundingClientRect().bottom + 4,
		});
	}
}
