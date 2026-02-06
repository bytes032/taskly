import TasklyPlugin from "../../main";
import { TaskInfo } from "../../types";
import { BasesDataItem, createTaskInfoFromBasesData } from "../helpers";
import { createUTCDateFromLocalCalendarDate, getDatePart } from "../../utils/dateUtils";
import { BasesDataAdapter } from "../BasesDataAdapter";

export interface TaskListCacheContext {
	data: any;
	config: any;
	dataAdapter: BasesDataAdapter;
	type: string;
	useTableLayout: boolean;
	showTableHeader: boolean;
	subGroupPropertyId: string | null;
	currentSearchTerm: string;
}

export interface RenderStateSnapshot {
	layoutKey: string;
	dateKey: string;
	visiblePropertiesKey: string;
}

export type TableSWRCacheEntry = {
	key: string;
	tasks: TaskInfo[];
	visibleProperties: string[];
	grouped: boolean;
	subGrouped: boolean;
	createdAt: number;
	baseKeyId: string;
};

const tableSWRCache = new Map<string, TableSWRCacheEntry>();
const tableSWRFallbackIndex = new Map<string, string>();
const tableSWRLastBaseKeyByView = new Map<string, string>();
const TABLE_SWR_MAX_ENTRIES = 3;

function clearSWRCache(): void {
	tableSWRCache.clear();
	tableSWRFallbackIndex.clear();
	tableSWRLastBaseKeyByView.clear();
}

export class TaskListCacheManager {
	private plugin: TasklyPlugin;
	private taskInfoMemoCache = new Map<string, { version: string; task: TaskInfo }>();
	private taskVersionCache = new Map<string, string>();
	private lastRenderedTaskVersions = new Map<string, string>();
	private lastRenderedVisiblePropertiesKey = "";
	private lastDataFingerprint = "";
	private lastRenderGroupKey = "";
	private lastRenderedLayoutKey = "";
	private lastRenderedDateKey = "";
	private lastRenderedFromCache = false;
	private lastCacheRenderTime = 0;
	private lastCacheKey = "";
	private lastCacheResolvedKey = "";

	constructor(plugin: TasklyPlugin) {
		this.plugin = plugin;
	}

	reset(): void {
		this.taskInfoMemoCache.clear();
		this.taskVersionCache.clear();
		this.lastRenderedTaskVersions.clear();
		this.lastRenderedVisiblePropertiesKey = "";
		this.lastDataFingerprint = "";
		this.lastRenderGroupKey = "";
		this.lastRenderedLayoutKey = "";
		this.lastRenderedDateKey = "";
		this.lastRenderedFromCache = false;
		this.lastCacheRenderTime = 0;
		this.lastCacheKey = "";
		this.lastCacheResolvedKey = "";
	}

	isSWREnabled(): boolean {
		return this.plugin.settings?.enableBasesSWR ?? true;
	}

	getRenderDateKey(): string {
		const localDate = createUTCDateFromLocalCalendarDate(new Date());
		return getDatePart(localDate.toISOString());
	}

	getRenderLayoutKey(
		useTableLayout: boolean,
		showTableHeader: boolean,
		searchTerm: string
	): string {
		return `${useTableLayout ? "table" : "list"}|${showTableHeader ? "header" : "noheader"}|search:${searchTerm}`;
	}

	getRenderSnapshot(
		useTableLayout: boolean,
		showTableHeader: boolean,
		searchTerm: string,
		visiblePropertiesKey: string
	): RenderStateSnapshot {
		return {
			layoutKey: this.getRenderLayoutKey(useTableLayout, showTableHeader, searchTerm),
			dateKey: this.getRenderDateKey(),
			visiblePropertiesKey,
		};
	}

	shouldSkipRender(
		dataFingerprint: string,
		groupKey: string,
		snapshot: RenderStateSnapshot,
		hasRenderedDom: boolean
	): boolean {
		return (
			dataFingerprint === this.lastDataFingerprint &&
			groupKey === this.lastRenderGroupKey &&
			snapshot.visiblePropertiesKey === this.lastRenderedVisiblePropertiesKey &&
			snapshot.layoutKey === this.lastRenderedLayoutKey &&
			snapshot.dateKey === this.lastRenderedDateKey &&
			hasRenderedDom
		);
	}

	recordRenderState(
		dataFingerprint: string,
		groupKey: string,
		snapshot: RenderStateSnapshot
	): void {
		this.lastDataFingerprint = dataFingerprint;
		this.lastRenderGroupKey = groupKey;
		this.lastRenderedVisiblePropertiesKey = snapshot.visiblePropertiesKey;
		this.lastRenderedLayoutKey = snapshot.layoutKey;
		this.lastRenderedDateKey = snapshot.dateKey;
	}

	markRenderedFromCache(cacheKey: string, resolvedKey: string): void {
		this.lastRenderedFromCache = true;
		this.lastCacheRenderTime = performance.now();
		this.lastCacheKey = cacheKey;
		this.lastCacheResolvedKey = resolvedKey;
	}

	logRevalidatedIfNeeded(): void {
		if (!this.lastRenderedFromCache) return;
		// Reset SWR revalidation state without logging.
		this.lastRenderedFromCache = false;
		this.lastCacheRenderTime = 0;
		this.lastCacheKey = "";
		this.lastCacheResolvedKey = "";
	}

	haveTaskVersionsChanged(taskItems: TaskInfo[], snapshot: RenderStateSnapshot): boolean {
		if (this.lastRenderedTaskVersions.size !== taskItems.length) return true;
		if (this.lastRenderedDateKey !== snapshot.dateKey) return true;
		if (this.lastRenderedLayoutKey !== snapshot.layoutKey) return true;
		if (this.lastRenderedVisiblePropertiesKey !== snapshot.visiblePropertiesKey) return true;

		for (const task of taskItems) {
			const version = this.taskVersionCache.get(task.path);
			if (!version) return true;
			if (this.lastRenderedTaskVersions.get(task.path) !== version) {
				return true;
			}
		}

		return false;
	}

	updateLastRenderedTaskVersions(taskItems: TaskInfo[], snapshot: RenderStateSnapshot): void {
		this.lastRenderedTaskVersions.clear();
		for (const task of taskItems) {
			const version = this.taskVersionCache.get(task.path) ?? "";
			this.lastRenderedTaskVersions.set(task.path, version);
		}
		this.lastRenderedDateKey = snapshot.dateKey;
		this.lastRenderedLayoutKey = snapshot.layoutKey;
		this.lastRenderedVisiblePropertiesKey = snapshot.visiblePropertiesKey;
	}

	identifyTasklyMemoized(dataItems: BasesDataItem[]): TaskInfo[] {
		const taskItems: TaskInfo[] = [];
		const seenPaths = new Set<string>();

		for (const item of dataItems) {
			const path = item?.path || item?.file?.path;
			if (!path) continue;

			seenPaths.add(path);

			const version = this.getBasesItemVersion(item);
			this.taskVersionCache.set(path, version);

			const cached = this.taskInfoMemoCache.get(path);
			if (cached && cached.version === version) {
				cached.task.basesData = item.basesData;
				taskItems.push(cached.task);
				continue;
			}

			try {
				const taskInfo = createTaskInfoFromBasesData(item, this.plugin);
				if (taskInfo) {
					this.taskInfoMemoCache.set(path, { version, task: taskInfo });
					taskItems.push(taskInfo);
				}
			} catch (error) {
				console.warn("[Taskly][BaseTaskView] Error converting Bases item to TaskInfo:", error);
			}
		}

		for (const key of this.taskInfoMemoCache.keys()) {
			if (!seenPaths.has(key)) {
				this.taskInfoMemoCache.delete(key);
				this.taskVersionCache.delete(key);
				this.lastRenderedTaskVersions.delete(key);
			}
		}

		return taskItems;
	}

	buildDataFingerprint(dataItems: BasesDataItem[]): string {
		let hash = 2166136261;
		for (const item of dataItems) {
			const path = item?.path || item?.file?.path;
			if (!path) continue;
			const version = this.getBasesItemVersion(item);
			hash = this.hashStringInto(hash, path);
			hash = this.hashStringInto(hash, "|");
			hash = this.hashStringInto(hash, version);
			hash = this.hashStringInto(hash, ";");
		}
		return `${(hash >>> 0).toString(16)}:${dataItems.length}`;
	}

	getStaleSWRCacheEntry(context: TaskListCacheContext): {
		entry: TableSWRCacheEntry;
		cacheKey: string;
		resolvedKey: string;
	} | null {
		if (!this.isSWREnabled()) return null;
		if (context.currentSearchTerm) {
			return null;
		}

		const cacheKey = this.getTableCacheKey(context);
		let entry = tableSWRCache.get(cacheKey);
		let resolvedKey = cacheKey;

		if (!entry) {
			let baseKeyId = this.getBaseKeyId(context);
			const viewIdentifier = this.getViewIdentifier(context);
			const lastBaseKey = tableSWRLastBaseKeyByView.get(viewIdentifier);

			if (lastBaseKey && !this.hasBaseKeyReady(context)) {
				baseKeyId = lastBaseKey;
			}

			const fallbackKey = tableSWRFallbackIndex.get(baseKeyId);
			if (fallbackKey) {
				const fallbackEntry = tableSWRCache.get(fallbackKey);
				if (fallbackEntry) {
					entry = fallbackEntry;
					resolvedKey = fallbackKey;
				}
			}
		}

		if (!entry || entry.grouped || entry.subGrouped) {
			return null;
		}

		return { entry, cacheKey, resolvedKey };
	}

	updateTableSWRCache(
		context: TaskListCacheContext,
		taskItems: TaskInfo[],
		visibleProperties: string[],
		isGrouped: boolean,
		isSubGrouped: boolean,
		getSnapshotTasks: (tasks: TaskInfo[], visibleProps: string[]) => TaskInfo[]
	): void {
		if (!this.isSWREnabled()) {
			clearSWRCache();
			return;
		}

		const cacheKey = this.getTableCacheKey(context);

		if (context.currentSearchTerm || isGrouped || isSubGrouped) {
			tableSWRCache.delete(cacheKey);
			for (const [baseKeyId, mappedKey] of tableSWRFallbackIndex) {
				if (mappedKey === cacheKey) {
					tableSWRFallbackIndex.delete(baseKeyId);
				}
			}
			return;
		}

		const entry: TableSWRCacheEntry = {
			key: cacheKey,
			tasks: getSnapshotTasks(taskItems, visibleProperties),
			visibleProperties: [...visibleProperties],
			grouped: false,
			subGrouped: false,
			createdAt: Date.now(),
			baseKeyId: this.getBaseKeyId(context),
		};

		tableSWRCache.set(cacheKey, entry);
		tableSWRFallbackIndex.set(entry.baseKeyId, cacheKey);
		tableSWRLastBaseKeyByView.set(this.getViewIdentifier(context), entry.baseKeyId);

		if (tableSWRCache.size > TABLE_SWR_MAX_ENTRIES) {
			let oldestKey: string | null = null;
			let oldestTime = Infinity;

			for (const [key, value] of tableSWRCache) {
				if (value.createdAt < oldestTime) {
					oldestTime = value.createdAt;
					oldestKey = key;
				}
			}

			if (oldestKey) {
				tableSWRCache.delete(oldestKey);
				for (const [baseKeyId, mappedKey] of tableSWRFallbackIndex) {
					if (mappedKey === oldestKey) {
						tableSWRFallbackIndex.delete(baseKeyId);
					}
				}
			}
		}
	}

	private getTableCacheKey(context: TaskListCacheContext): string {
		const configAny = context.config as any;
		const configId =
			(typeof configAny?.id === "string" && configAny.id) ||
			(typeof configAny?.viewId === "string" && configAny.viewId) ||
			(typeof configAny?.getId === "function" && configAny.getId()) ||
			(typeof configAny?.getViewId === "function" && configAny.getViewId()) ||
			"";

		const queryAny = context.data?.query as any;
		const queryId =
			(typeof queryAny?.id === "string" && queryAny.id) ||
			(typeof queryAny?.name === "string" && queryAny.name) ||
			(typeof queryAny?.path === "string" && queryAny.path) ||
			(typeof queryAny?.file?.path === "string" && queryAny.file.path) ||
			"";

		let order = "";
		try {
			order = context.dataAdapter.getVisiblePropertyIds().join(",");
		} catch {
			order = "";
		}

		let sortSignature = "";
		try {
			sortSignature = this.safeStringifyForCache(context.dataAdapter.getSortConfig?.());
		} catch {
			sortSignature = "";
		}

		const querySignature = this.getQuerySignatureForCache(context.data, context.config);
		const viewKey = queryId || configId || context.type;
		const orderKey = this.compactCacheKey("cols", order);
		const sortKey = this.compactCacheKey("sort", sortSignature);
		const queryKey = this.compactCacheKey("filter", querySignature);
		return [
			context.type,
			viewKey,
			context.useTableLayout ? "table" : "list",
			context.showTableHeader ? "header" : "noheader",
			context.subGroupPropertyId ?? "",
			orderKey,
			sortKey,
			queryKey,
		].join("|");
	}

	private getBaseKeyId(context: TaskListCacheContext): string {
		let order = "";
		try {
			order = context.dataAdapter.getVisiblePropertyIds().join(",");
		} catch {
			order = "";
		}

		let sortSignature = "";
		try {
			sortSignature = this.safeStringifyForCache(context.dataAdapter.getSortConfig?.());
		} catch {
			sortSignature = "";
		}

		const orderKey = this.compactCacheKey("cols", order);
		const sortKey = this.compactCacheKey("sort", sortSignature);

		return [
			context.type,
			context.useTableLayout ? "table" : "list",
			context.showTableHeader ? "header" : "noheader",
			context.subGroupPropertyId ?? "",
			orderKey,
			sortKey,
		].join("|");
	}

	private hasBaseKeyReady(context: TaskListCacheContext): boolean {
		let order = "";
		try {
			order = context.dataAdapter.getVisiblePropertyIds().join(",");
		} catch {
			order = "";
		}

		return !!order;
	}

	private getViewIdentifier(context: TaskListCacheContext): string {
		const configAny = context.config as any;
		const configId =
			(typeof configAny?.id === "string" && configAny.id) ||
			(typeof configAny?.viewId === "string" && configAny.viewId) ||
			(typeof configAny?.getId === "function" && configAny.getId()) ||
			(typeof configAny?.getViewId === "function" && configAny.getViewId()) ||
			"";

		const queryAny = context.data?.query as any;
		const queryId =
			(typeof queryAny?.id === "string" && queryAny.id) ||
			(typeof queryAny?.name === "string" && queryAny.name) ||
			(typeof queryAny?.path === "string" && queryAny.path) ||
			(typeof queryAny?.file?.path === "string" && queryAny.file.path) ||
			"";

		return `${context.type}:${queryId || configId || "default"}`;
	}

	private getQuerySignatureForCache(data: any, config: any): string {
		const queryAny = data?.query as any;
		const configAny = config as any;

		const candidates = [
			queryAny && typeof queryAny.getViewConfig === "function" ? queryAny.getViewConfig() : null,
			queryAny && typeof queryAny.getState === "function" ? queryAny.getState() : null,
			queryAny?.viewConfig,
			queryAny?.filters,
			queryAny?.filter,
			queryAny?.where,
			queryAny?.query,
			configAny && typeof configAny.getViewConfig === "function" ? configAny.getViewConfig() : null,
			configAny?.viewConfig,
			configAny?.state,
			configAny?.filters,
		];

		for (const candidate of candidates) {
			const signature = this.safeStringifyForCache(candidate);
			if (signature) {
				return signature;
			}
		}

		return this.safeStringifyForCache(queryAny ?? configAny);
	}

	private safeStringifyForCache(value: unknown, maxLength = 500): string {
		if (!value) return "";
		try {
			const seen = new WeakSet<object>();
			const json = JSON.stringify(value, (_key, val) => {
				if (typeof _key === "string") {
					const lowered = _key.toLowerCase();
					if (
						lowered === "id" ||
						lowered === "viewid" ||
						lowered === "leafid" ||
						lowered === "instanceid" ||
						lowered === "uuid" ||
						lowered === "uid"
					) {
						return undefined;
					}
				}
				if (typeof val === "function") return undefined;
				if (typeof val === "object" && val !== null) {
					if (seen.has(val)) return undefined;
					seen.add(val);
				}
				return val;
			});
			if (!json) return "";
			return json.length > maxLength ? json.slice(0, maxLength) : json;
		} catch {
			return "";
		}
	}

	private compactCacheKey(label: string, value: string): string {
		if (!value) return "";
		return `${label}:${this.hashForCache(value)}`;
	}

	private hashForCache(value: string): string {
		let hash = 2166136261;
		for (let i = 0; i < value.length; i++) {
			hash ^= value.charCodeAt(i);
			hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		}
		return (hash >>> 0).toString(16);
	}

	private hashStringInto(seed: number, value: string): number {
		let hash = seed;
		for (let i = 0; i < value.length; i++) {
			hash ^= value.charCodeAt(i);
			hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		}
		return hash >>> 0;
	}

	private getBasesItemVersion(item: BasesDataItem): string {
		const file = item.file as any;
		const stat = file?.stat;
		const mtime = stat?.mtime ?? stat?.mtimeMs ?? 0;
		const size = stat?.size ?? 0;
		const dataVersion =
			(item as any).data?.version ??
			(item as any).data?.revision ??
			(item as any).basesData?.version ??
			"";
		return `${mtime}|${size}|${dataVersion}`;
	}
}
