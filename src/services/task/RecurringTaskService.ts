import { TFile } from "obsidian";
import TasklyPlugin from "../../main";
import { TaskInfo } from "../../types";
import {
	addDTSTARTToRecurrenceRule,
	updateDTSTARTInRecurrenceRule,
	updateToNextDueOccurrence,
} from "../../utils/helpers";
import {
	formatDateForStorage,
	getCurrentTimestamp,
	getTodayLocal,
	createUTCDateFromLocalCalendarDate,
} from "../../utils/dateUtils";
import { EVENT_TASK_UPDATED } from "../../types";

export class RecurringTaskService {
	constructor(private plugin: TasklyPlugin) {}

	/**
	 * Toggle completion status for recurring tasks on a specific date
	 */
	async toggleRecurringTaskComplete(task: TaskInfo, date?: Date): Promise<TaskInfo> {
		const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot find task file: ${task.path}`);
		}

		// Get fresh task data to ensure we have the latest completion state
		const freshTask = (await this.plugin.cacheManager.getTaskInfo(task.path)) || task;

		if (!freshTask.recurrence) {
			throw new Error("Task is not recurring");
		}

		// Default to local today instead of selectedDate for recurring task completion
		// This ensures completion is recorded for user's actual calendar day unless explicitly overridden
		const targetDate =
			date ||
			(() => {
				const todayLocal = getTodayLocal();
				return createUTCDateFromLocalCalendarDate(todayLocal);
			})();
		const dateStr = formatDateForStorage(targetDate);

		// Check current completion status for this date using fresh data
		const completeInstances = Array.isArray(freshTask.complete_instances)
			? freshTask.complete_instances
			: [];
		const currentComplete = completeInstances.includes(dateStr);
		const newComplete = !currentComplete;

		// Step 1: Construct new state in memory using fresh data
		const updatedTask = { ...freshTask };
		updatedTask.dateModified = getCurrentTimestamp();

		if (newComplete) {
			// Add date to completed instances if not already present
			if (!completeInstances.includes(dateStr)) {
				updatedTask.complete_instances = [...completeInstances, dateStr];
			}
			// Remove from skipped_instances if present (can't be both completed and skipped)
			const skippedInstances = Array.isArray(freshTask.skipped_instances)
				? freshTask.skipped_instances
				: [];
			updatedTask.skipped_instances = skippedInstances.filter((d) => d !== dateStr);
		} else {
			// Remove date from completed instances
			updatedTask.complete_instances = completeInstances.filter((d) => d !== dateStr);
			// Also remove from skipped_instances (marking as incomplete)
			const skippedInstances = Array.isArray(freshTask.skipped_instances)
				? freshTask.skipped_instances
				: [];
			updatedTask.skipped_instances = skippedInstances.filter((d) => d !== dateStr);
		}

		// Handle DTSTART in recurrence rule when completing
		if (newComplete && typeof updatedTask.recurrence === "string") {
			const recurrenceAnchor = updatedTask.recurrence_anchor || "due";

			if (recurrenceAnchor === "completion") {
				// For completion-based recurrence, update DTSTART to the completion date
				// This shifts the anchor point so future occurrences calculate from this completion
				const updatedRecurrence = updateDTSTARTInRecurrenceRule(
					updatedTask.recurrence,
					dateStr
				);
				if (updatedRecurrence) {
					updatedTask.recurrence = updatedRecurrence;
				}
			} else if (!updatedTask.recurrence.includes("DTSTART:")) {
				// For due-based recurrence, just add DTSTART if missing (preserves original anchor)
				const updatedRecurrence = addDTSTARTToRecurrenceRule(updatedTask);
				if (updatedRecurrence) {
					updatedTask.recurrence = updatedRecurrence;
				}
			}
		}

		// Update due date to next uncompleted occurrence
		const nextDates = updateToNextDueOccurrence(updatedTask);
		if (nextDates.due) {
			updatedTask.due = nextDates.due;
		}

		// Step 2: Persist to file
		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const completeInstancesField = this.plugin.fieldMapper.toUserField("completeInstances");
			const skippedInstancesField = this.plugin.fieldMapper.toUserField("skippedInstances");
			const dateModifiedField = this.plugin.fieldMapper.toUserField("dateModified");
			const dueField = this.plugin.fieldMapper.toUserField("due");
			const recurrenceField = this.plugin.fieldMapper.toUserField("recurrence");

			// Ensure complete_instances array exists
			if (!frontmatter[completeInstancesField]) {
				frontmatter[completeInstancesField] = [];
			}

			// Ensure skipped_instances array exists
			if (!frontmatter[skippedInstancesField]) {
				frontmatter[skippedInstancesField] = [];
			}

			const completeDates: string[] = frontmatter[completeInstancesField];

			if (newComplete) {
				// Add date to completed instances if not already present
				if (!completeDates.includes(dateStr)) {
					frontmatter[completeInstancesField] = [...completeDates, dateStr];
				}
			} else {
				// Remove date from completed instances
				frontmatter[completeInstancesField] = completeDates.filter((d) => d !== dateStr);
			}

			// Update skipped_instances (remove when completing or marking incomplete)
			frontmatter[skippedInstancesField] = updatedTask.skipped_instances || [];

			// Update recurrence field if it was updated with DTSTART
			if (updatedTask.recurrence !== freshTask.recurrence) {
				frontmatter[recurrenceField] = updatedTask.recurrence;
			}

			// Update due date if it changed
			if (updatedTask.due) {
				frontmatter[dueField] = updatedTask.due;
			}

			frontmatter[dateModifiedField] = updatedTask.dateModified;
		});

		// Step 3: Wait for fresh data and update cache
		try {
			// Wait for the metadata cache to have the updated data
			if (this.plugin.cacheManager.waitForFreshTaskData) {
				const expectedChanges: Partial<TaskInfo> = {
					complete_instances: updatedTask.complete_instances,
				};
				if (updatedTask.due !== freshTask.due) {
					expectedChanges.due = updatedTask.due;
				}
				await this.plugin.cacheManager.waitForFreshTaskData(file);
			}
			this.plugin.cacheManager.updateTaskInfoInCache(freshTask.path, updatedTask);
		} catch (cacheError) {
			console.error("Error updating cache for recurring task:", cacheError);
		}

		// Step 4: Notify system of change
		this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
			path: freshTask.path,
			originalTask: freshTask,
			updatedTask: updatedTask,
		});


		// Step 6: Return authoritative data
		return updatedTask;
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
		const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot find task file: ${task.path}`);
		}

		// Get fresh task data to avoid stale data issues
		const freshTask = (await this.plugin.cacheManager.getTaskInfo(task.path)) || task;

		if (!freshTask.recurrence) {
			throw new Error("Task is not recurring");
		}

		// Default to local today
		const targetDate =
			date ||
			(() => {
				const todayLocal = getTodayLocal();
				return createUTCDateFromLocalCalendarDate(todayLocal);
			})();
		const dateStr = formatDateForStorage(targetDate);

		// Check current skip status for this date
		const skippedInstances = Array.isArray(freshTask.skipped_instances)
			? freshTask.skipped_instances
			: [];
		const currentlySkipped = skippedInstances.includes(dateStr);
		const newSkipped = !currentlySkipped;

		// Step 1: Construct new state in memory
		const updatedTask = { ...freshTask };
		updatedTask.dateModified = getCurrentTimestamp();

		if (newSkipped) {
			// Mark as skipped
			if (!skippedInstances.includes(dateStr)) {
				updatedTask.skipped_instances = [...skippedInstances, dateStr];
			}

			// Remove from complete_instances if present (can't be both)
			const completeInstances = Array.isArray(freshTask.complete_instances)
				? freshTask.complete_instances
				: [];
			updatedTask.complete_instances = completeInstances.filter((d) => d !== dateStr);
		} else {
			// Unskip
			updatedTask.skipped_instances = skippedInstances.filter((d) => d !== dateStr);
		}

		// Step 2: Update due date to next uncompleted occurrence
		// (This will skip over both completed AND skipped instances)
		const nextDates = updateToNextDueOccurrence(updatedTask);
		if (nextDates.due) {
			updatedTask.due = nextDates.due;
		}

		// Step 3: Persist to file
		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const skippedField = this.plugin.fieldMapper.toUserField("skippedInstances");
			const completeField = this.plugin.fieldMapper.toUserField("completeInstances");
			const dateModifiedField = this.plugin.fieldMapper.toUserField("dateModified");
			const dueField = this.plugin.fieldMapper.toUserField("due");

			// Ensure skipped_instances array exists
			if (!frontmatter[skippedField]) {
				frontmatter[skippedField] = [];
			}

			// Update skipped instances
			frontmatter[skippedField] = updatedTask.skipped_instances || [];

			// Update complete instances (in case we removed from it)
			if (!frontmatter[completeField]) {
				frontmatter[completeField] = [];
			}
			frontmatter[completeField] = updatedTask.complete_instances || [];

			// Update due date
			if (updatedTask.due) {
				frontmatter[dueField] = updatedTask.due;
			}

			frontmatter[dateModifiedField] = updatedTask.dateModified;
		});

		// Step 4: Wait for fresh data and update cache
		try {
			if (this.plugin.cacheManager.waitForFreshTaskData) {
				await this.plugin.cacheManager.waitForFreshTaskData(file);
			}
			this.plugin.cacheManager.updateTaskInfoInCache(freshTask.path, updatedTask);
		} catch (cacheError) {
			console.error("Error updating cache for skipped recurring task:", cacheError);
		}

		// Step 5: Notify system of change
		this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
			path: freshTask.path,
			originalTask: freshTask,
			updatedTask: updatedTask,
		});

		// Step 6: Return authoritative data
		return updatedTask;
	}
}
