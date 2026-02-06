import { TaskInfo, TaskSortKey, SortDirection } from "../../types";
import { TaskManager } from "../../utils/TaskManager";
import { StatusManager } from "../StatusManager";
import { isBeforeDateTimeAware } from "../../utils/dateUtils";
import { normalizeUserListValue } from "./FilterUserFieldUtils";
import type TasklyPlugin from "../../main";

export class FilterSortService {
	constructor(
		private cacheManager: TaskManager,
		private statusManager: StatusManager,
		private plugin?: TasklyPlugin
	) {}

	sortTasks(tasks: TaskInfo[], sortKey: TaskSortKey, direction: SortDirection): TaskInfo[] {
		return tasks.sort((a, b) => {
			let comparison = 0;

			if (typeof sortKey === "string" && sortKey.startsWith("user:")) {
				comparison = this.compareByUserField(a, b, sortKey as `user:${string}`);
			} else {
				switch (sortKey) {
					case "due":
						comparison = this.compareDates(a.due, b.due);
						break;
					case "status":
						comparison = this.compareStatuses(a.status, b.status);
						break;
					case "title":
						comparison = a.title.localeCompare(b.title);
						break;
					case "dateCreated":
						comparison = this.compareDates(a.dateCreated, b.dateCreated);
						break;
					case "completedDate":
						comparison = this.compareDates(a.completedDate, b.completedDate);
						break;
					case "tags":
						comparison = this.compareTags(a.tags, b.tags);
						break;
				}
			}

			if (comparison === 0) {
				comparison = this.applyFallbackSorting(a, b, sortKey);
			}

			return direction === "desc" ? -comparison : comparison;
		});
	}

	private compareDates(dateA?: string, dateB?: string): number {
		if (!dateA && !dateB) return 0;
		if (!dateA) return 1;
		if (!dateB) return -1;

		try {
			if (isBeforeDateTimeAware(dateA, dateB)) {
				return -1;
			} else if (isBeforeDateTimeAware(dateB, dateA)) {
				return 1;
			} else {
				return 0;
			}
		} catch (error) {
			console.error("Error comparing dates time-aware:", { dateA, dateB, error });
			return dateA.localeCompare(dateB);
		}
	}

	private compareStatuses(statusA: string, statusB: string): number {
		const orderA = this.statusManager.getStatusOrder(statusA);
		const orderB = this.statusManager.getStatusOrder(statusB);
		return orderA - orderB;
	}

	private compareTags(tagsA: string[] | undefined, tagsB: string[] | undefined): number {
		const normalizedTagsA = tagsA && tagsA.length > 0 ? tagsA : [];
		const normalizedTagsB = tagsB && tagsB.length > 0 ? tagsB : [];

		if (normalizedTagsA.length === 0 && normalizedTagsB.length === 0) {
			return 0;
		}

		if (normalizedTagsA.length === 0) return 1;
		if (normalizedTagsB.length === 0) return -1;

		const firstTagA = normalizedTagsA[0].toLowerCase();
		const firstTagB = normalizedTagsB[0].toLowerCase();

		return firstTagA.localeCompare(firstTagB);
	}

	private applyFallbackSorting(a: TaskInfo, b: TaskInfo, primarySortKey: TaskSortKey): number {
		const fallbackOrder: TaskSortKey[] = ["due", "title"];
		const fallbacks = fallbackOrder.filter((key) => key !== primarySortKey);

		for (const fallbackKey of fallbacks) {
			let comparison = 0;

			switch (fallbackKey) {
				case "due":
					comparison = this.compareDates(a.due, b.due);
					break;
				case "title":
					comparison = a.title.localeCompare(b.title);
					break;
			}

			if (comparison !== 0) {
				return comparison;
			}
		}

		return 0;
	}

	private compareByUserField(a: TaskInfo, b: TaskInfo, sortKey: `user:${string}`): number {
		const fieldId = sortKey.slice(5);
		const userFields = this.plugin?.settings?.userFields || [];
		const field = userFields.find((f: any) => (f.id || f.key) === fieldId);
		if (!field) return 0;

		const getRaw = (t: TaskInfo) => {
			try {
				const app = this.cacheManager.getApp();
				const file = app.vault.getAbstractFileByPath(t.path);
				const fm = file
					? app.metadataCache.getFileCache(file as any)?.frontmatter
					: undefined;
				return fm ? fm[field.key] : undefined;
			} catch {
				return undefined;
			}
		};

		const rawA = getRaw(a);
		const rawB = getRaw(b);

		switch (field.type) {
			case "number": {
				const numA =
					typeof rawA === "number" ? rawA : rawA != null ? parseFloat(String(rawA)) : NaN;
				const numB =
					typeof rawB === "number" ? rawB : rawB != null ? parseFloat(String(rawB)) : NaN;
				const isNumA = !isNaN(numA);
				const isNumB = !isNaN(numB);
				if (isNumA && isNumB) return numA - numB;
				if (isNumA && !isNumB) return -1;
				if (!isNumA && isNumB) return 1;
				return 0;
			}
			case "boolean": {
				const toBool = (v: any): boolean | undefined => {
					if (typeof v === "boolean") return v;
					if (v == null) return undefined;
					const s = String(v).trim().toLowerCase();
					if (s === "true") return true;
					if (s === "false") return false;
					return undefined;
				};
				const bA = toBool(rawA);
				const bB = toBool(rawB);
				if (bA === bB) return 0;
				if (bA === true) return -1;
				if (bB === true) return 1;
				if (bA === false) return -1;
				if (bB === false) return 1;
				return 0;
			}
			case "date": {
				const tA = rawA ? Date.parse(String(rawA)) : NaN;
				const tB = rawB ? Date.parse(String(rawB)) : NaN;
				const isValidA = !isNaN(tA);
				const isValidB = !isNaN(tB);
				if (isValidA && isValidB) return tA - tB;
				if (isValidA && !isValidB) return -1;
				if (!isValidA && isValidB) return 1;
				return 0;
			}
			case "list": {
				const toFirst = (v: any): string | undefined => {
					if (Array.isArray(v)) {
						const tokens = normalizeUserListValue(v);
						return tokens[0];
					}
					if (typeof v === "string") {
						if (v.trim().length === 0) return "";
						const tokens = normalizeUserListValue(v);
						return tokens[0];
					}
					return undefined;
				};
				const sA = toFirst(rawA);
				const sB = toFirst(rawB);
				if ((sA == null || sA === "") && (sB == null || sB === "")) return 0;
				if (sA == null || sA === "") return 1;
				if (sB == null || sB === "") return -1;
				return sA.localeCompare(sB);
			}
			case "text":
			default: {
				const sA = rawA != null ? String(rawA) : "";
				const sB = rawB != null ? String(rawB) : "";
				return sA.localeCompare(sB);
			}
		}
	}
}
