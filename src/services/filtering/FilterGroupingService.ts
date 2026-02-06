import { format, parseISO } from "date-fns";
import { TaskInfo, TaskGroupKey, TaskSortKey, SortDirection } from "../../types";
import { TaskManager } from "../../utils/TaskManager";
import { StatusManager } from "../StatusManager";
import { isDueByRRule } from "../../utils/helpers";
import {
	getDatePart,
	getTodayString,
	isBeforeDateSafe,
	isSameDateSafe,
	isBeforeDateTimeAware,
	isOverdueTimeAware,
	startOfDayForDateString,
} from "../../utils/dateUtils";
import { normalizeUserListValue } from "./FilterUserFieldUtils";
import type TasklyPlugin from "../../main";

export class FilterGroupingService {
	private currentSortKey?: TaskSortKey;
	private currentSortDirection?: SortDirection;

	constructor(
		private cacheManager: TaskManager,
		private statusManager: StatusManager,
		private plugin?: TasklyPlugin
	) {}

	setSortContext(sortKey?: TaskSortKey, direction?: SortDirection): void {
		this.currentSortKey = sortKey;
		this.currentSortDirection = direction;
	}

	groupTasks(
		tasks: TaskInfo[],
		groupKey: TaskGroupKey,
		targetDate?: Date
	): Map<string, TaskInfo[]> {
		if (groupKey === "none") {
			return new Map([["all", tasks]]);
		}

		const groups = new Map<string, TaskInfo[]>();

		for (const task of tasks) {
			if (groupKey === "tags") {
				const taskTags = task.tags || [];
				if (taskTags.length > 0) {
					for (const tag of taskTags) {
						if (!groups.has(tag)) {
							groups.set(tag, []);
						}
						groups.get(tag)?.push(task);
					}
				} else {
					const noTagsGroup = this.getNoTagsLabel();
					if (!groups.has(noTagsGroup)) {
						groups.set(noTagsGroup, []);
					}
					groups.get(noTagsGroup)?.push(task);
				}
			} else {
				let groupValue: string;

				if (typeof groupKey === "string" && groupKey.startsWith("user:")) {
					groupValue = this.getUserFieldGroupValue(task, groupKey);
				} else {
					switch (groupKey) {
						case "status":
							groupValue = task.status || "no-status";
							break;
						case "due":
							groupValue = this.getDueDateGroup(task, targetDate);
							break;
						case "completedDate":
							groupValue = this.getCompletedDateGroup(task);
							break;
						default:
							groupValue = "unknown";
					}
				}

				if (!groups.has(groupValue)) {
					groups.set(groupValue, []);
				}
				groups.get(groupValue)?.push(task);
			}
		}

		return this.sortGroups(groups, groupKey);
	}

	private getUserFieldGroupValue(task: TaskInfo, groupKey: string): string {
		const fieldId = groupKey.slice(5);
		const userFields = this.plugin?.settings?.userFields || [];
		const field = userFields.find((f: any) => (f.id || f.key) === fieldId);
		if (!field) return "unknown-field";

		try {
			const app = this.cacheManager.getApp();
			const file = app.vault.getAbstractFileByPath(task.path);
			if (!file) return "no-value";
			const fm = app.metadataCache.getFileCache(file as any)?.frontmatter;
			const raw = fm ? fm[field.key] : undefined;

			switch (field.type) {
				case "boolean": {
					if (typeof raw === "boolean") return raw ? "true" : "false";
					if (raw == null) return "no-value";
					const s = String(raw).trim().toLowerCase();
					if (s === "true") return "true";
					if (s === "false") return "false";
					return "no-value";
				}
				case "number": {
					if (typeof raw === "number") return String(raw);
					if (typeof raw === "string") {
						const match = raw.match(/^(\d+(?:\.\d+)?)/);
						return match ? match[1] : "non-numeric";
					}
					return "no-value";
				}
				case "date":
					return raw ? String(raw) : "no-date";
				case "list": {
					if (Array.isArray(raw)) {
						const tokens = normalizeUserListValue(raw);
						return tokens.length > 0 ? tokens[0] : "empty";
					}
					if (typeof raw === "string") {
						if (raw.trim().length === 0) return "empty";
						const tokens = normalizeUserListValue(raw);
						return tokens.length > 0 ? tokens[0] : "empty";
					}
					return "no-value";
				}
				case "text":
				default:
					return raw ? String(raw).trim() || "empty" : "no-value";
			}
		} catch (e) {
			console.error("Error extracting user field value for grouping", e);
			return "error";
		}
	}

	private getDueDateGroup(task: TaskInfo, targetDate?: Date): string {
		const referenceDate = targetDate || new Date();
		referenceDate.setHours(0, 0, 0, 0);

		const isCompleted = this.statusManager.isCompletedStatus(task.status);
		const hideCompletedFromOverdue = this.plugin?.settings?.hideCompletedFromOverdue ?? true;

		if (task.recurrence) {
			if (isDueByRRule(task, referenceDate)) {
				const referenceDateStr = format(referenceDate, "yyyy-MM-dd");
				return this.getDateGroupFromDateStringWithTask(
					referenceDateStr,
					isCompleted,
					hideCompletedFromOverdue
				);
			} else {
				if (task.due) {
					return this.getDateGroupFromDateStringWithTask(
						task.due,
						isCompleted,
						hideCompletedFromOverdue
					);
				}
				return this.getDueGroupLabel("none");
			}
		}

		if (!task.due) return this.getDueGroupLabel("none");
		return this.getDateGroupFromDateStringWithTask(
			task.due,
			isCompleted,
			hideCompletedFromOverdue
		);
	}

	private getDateGroupFromDateString(dateString: string): string {
		const todayStr = getTodayString();

		if (isOverdueTimeAware(dateString)) return this.getDueGroupLabel("overdue");

		const datePart = getDatePart(dateString);
		if (isSameDateSafe(datePart, todayStr)) return this.getDueGroupLabel("today");

		try {
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const tomorrowStr = format(tomorrow, "yyyy-MM-dd");
			if (isSameDateSafe(datePart, tomorrowStr)) return this.getDueGroupLabel("tomorrow");

			const thisWeek = new Date();
			thisWeek.setDate(thisWeek.getDate() + 7);
			const thisWeekStr = format(thisWeek, "yyyy-MM-dd");
			if (isBeforeDateSafe(datePart, thisWeekStr) || isSameDateSafe(datePart, thisWeekStr))
				return this.getDueGroupLabel("nextSevenDays");

			return this.getDueGroupLabel("later");
		} catch (error) {
			console.error(`Error categorizing date ${dateString}:`, error);
			return this.getInvalidDateLabel();
		}
	}

	private getDateGroupFromDateStringWithTask(
		dateString: string,
		isCompleted: boolean,
		hideCompletedFromOverdue: boolean
	): string {
		const todayStr = getTodayString();

		if (isOverdueTimeAware(dateString, isCompleted, hideCompletedFromOverdue))
			return this.getDueGroupLabel("overdue");

		const datePart = getDatePart(dateString);
		if (isSameDateSafe(datePart, todayStr)) return this.getDueGroupLabel("today");

		try {
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const tomorrowStr = format(tomorrow, "yyyy-MM-dd");
			if (isSameDateSafe(datePart, tomorrowStr)) return this.getDueGroupLabel("tomorrow");

			const thisWeek = new Date();
			thisWeek.setDate(thisWeek.getDate() + 7);
			const thisWeekStr = format(thisWeek, "yyyy-MM-dd");
			if (isBeforeDateSafe(datePart, thisWeekStr) || isSameDateSafe(datePart, thisWeekStr))
				return this.getDueGroupLabel("nextSevenDays");

			return this.getDueGroupLabel("later");
		} catch (error) {
			console.error(`Error categorizing date ${dateString}:`, error);
			return this.getInvalidDateLabel();
		}
	}

	private getCompletedDateGroup(task: TaskInfo): string {
		if (!task.completedDate) return "Not completed";

		try {
			const completedDate = parseISO(task.completedDate);
			return format(completedDate, "yyyy-MM-dd");
		} catch (error) {
			console.error(`Error formatting completed date ${task.completedDate}:`, error);
			return "Invalid date";
		}
	}

	private sortGroups(
		groups: Map<string, TaskInfo[]>,
		groupKey: TaskGroupKey
	): Map<string, TaskInfo[]> {
		const sortedGroups = new Map<string, TaskInfo[]>();
		let sortedKeys: string[];

		if (typeof groupKey === "string" && groupKey.startsWith("user:")) {
			sortedKeys = this.sortUserFieldGroups(Array.from(groups.keys()), groupKey);
			if (this.currentSortKey === groupKey && this.currentSortDirection === "desc") {
				sortedKeys.reverse();
			}
		} else {
			switch (groupKey) {
				case "status":
					sortedKeys = Array.from(groups.keys()).sort((a, b) => {
						const orderA = this.statusManager.getStatusOrder(a);
						const orderB = this.statusManager.getStatusOrder(b);
						return orderA - orderB;
					});
					break;

				case "due": {
					const dueOrderKeys: Array<
						"overdue" | "today" | "tomorrow" | "nextSevenDays" | "later" | "none"
					> = ["overdue", "today", "tomorrow", "nextSevenDays", "later", "none"];
					const dueOrderMap = new Map(
						dueOrderKeys.map((key, index) => [this.getDueGroupLabel(key), index])
					);
					sortedKeys = Array.from(groups.keys()).sort((a, b) => {
						const indexA = dueOrderMap.get(a) ?? dueOrderKeys.length;
						const indexB = dueOrderMap.get(b) ?? dueOrderKeys.length;
						return indexA - indexB;
					});
					break;
				}

				case "tags":
					sortedKeys = Array.from(groups.keys()).sort((a, b) => {
						const noTagsLabel = this.getNoTagsLabel();
						if (a === noTagsLabel) return 1;
						if (b === noTagsLabel) return -1;
						if (a == null) return 1;
						if (b == null) return -1;
						return a.localeCompare(b, this.getLocale());
					});
					break;

				case "completedDate":
					sortedKeys = Array.from(groups.keys()).sort((a, b) => {
						const notCompletedLabel = "Not completed";
						if (a === notCompletedLabel) return 1;
						if (b === notCompletedLabel) return -1;
						if (a === "Invalid date") return 1;
						if (b === "Invalid date") return -1;
						if (a == null || b == null) {
							if (a == null) return 1;
							if (b == null) return -1;
						}
						return b.localeCompare(a);
					});
					break;

				default:
					sortedKeys = Array.from(groups.keys()).sort((a, b) =>
						a == null ? 1 : b == null ? -1 : a.localeCompare(b, this.getLocale())
					);
			}
		}

		for (const key of sortedKeys) {
			const group = groups.get(key);
			if (group) {
				sortedGroups.set(key, group);
			}
		}

		return sortedGroups;
	}

	private sortUserFieldGroups(groupKeys: string[], groupKey: string): string[] {
		const fieldId = groupKey.slice(5);
		const userFields = this.plugin?.settings?.userFields || [];
		const field = userFields.find((f: any) => (f.id || f.key) === fieldId);
		if (!field) return groupKeys.sort();

		switch (field.type) {
			case "number":
				return groupKeys.sort((a, b) => {
					const numA = parseFloat(a);
					const numB = parseFloat(b);
					const isNumA = !isNaN(numA);
					const isNumB = !isNaN(numB);
					if (isNumA && isNumB) return numB - numA;
					if (isNumA && !isNumB) return -1;
					if (!isNumA && isNumB) return 1;
					return a == null ? 1 : b == null ? -1 : a.localeCompare(b);
				});
			case "boolean":
				return groupKeys.sort((a, b) => {
					if (a === "true" && b === "false") return -1;
					if (a === "false" && b === "true") return 1;
					return a == null ? 1 : b == null ? -1 : a.localeCompare(b);
				});
			case "date":
				return groupKeys.sort((a, b) => {
					const tA = Date.parse(a);
					const tB = Date.parse(b);
					const isValidA = !isNaN(tA);
					const isValidB = !isNaN(tB);
					if (isValidA && isValidB) return tA - tB;
					if (isValidA && !isValidB) return -1;
					if (!isValidA && isValidB) return 1;
					return a == null ? 1 : b == null ? -1 : a.localeCompare(b);
				});
			case "text":
			case "list":
			default:
				return groupKeys.sort((a, b) =>
					a == null ? 1 : b == null ? -1 : a.localeCompare(b)
				);
		}
	}

	private getDueGroupLabel(
		code: "overdue" | "today" | "tomorrow" | "nextSevenDays" | "later" | "none" | "invalid"
	): string {
		switch (code) {
			case "overdue":
				return "Overdue";
			case "today":
				return "Today";
			case "tomorrow":
				return "Tomorrow";
			case "nextSevenDays":
				return "Next seven days";
			case "later":
				return "Later";
			case "none":
				return "No due date";
			case "invalid":
			default:
				return "Invalid date";
		}
	}

	private getNoTagsLabel(): string {
		return "No tags";
	}

	private getInvalidDateLabel(): string {
		return "Invalid date";
	}

	private getLocale(): string {
		return "en";
	}
}
