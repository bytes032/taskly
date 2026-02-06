/* eslint-disable no-console */
import { FilterQuery, ViewFilterState, ViewPreferences } from "../types";
import { EventEmitter } from "../utils/EventEmitter";
import { FilterUtils } from "../utils/FilterUtils";
import { App } from "obsidian";
import type TasklyPlugin from "../main";

/**
 * Manages view-specific state like filter preferences across the application
 */
export class ViewStateManager extends EventEmitter {
	private filterState: ViewFilterState = {};
	private viewPreferences: ViewPreferences = {};
	private storageKey = "taskly-view-filter-state";
	private preferencesStorageKey = "taskly-view-preferences";
	private app: App;
	private plugin: TasklyPlugin;

	constructor(app: App, plugin: TasklyPlugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		this.loadFromStorage();
		this.loadPreferencesFromStorage();
	}

	/**
	 * Get filter state for a specific view
	 */
	getFilterState(viewType: string): FilterQuery | undefined {
		const state = this.filterState[viewType];

		if (!state) {
			return undefined;
		}

		// Check if state has the new FilterGroup structure (v3.13.0+)
		// If it's old format, ignore it and return undefined to use default
		if (
			typeof state !== "object" ||
			state.type !== "group" ||
			!Array.isArray(state.children) ||
			typeof state.conjunction !== "string"
		) {
			console.warn(
				`ViewStateManager: Ignoring old format filter state for ${viewType}, will use default`
			);
			// Clear the old format data
			delete this.filterState[viewType];
			this.saveToStorage();
			return undefined;
		}

		return FilterUtils.deepCloneFilterQuery(state);
	}

	/**
	 * Set filter state for a specific view
	 */
	setFilterState(viewType: string, query: FilterQuery): void {
		this.filterState[viewType] = FilterUtils.deepCloneFilterQuery(query);
		this.saveToStorage();
		this.emit("filter-state-changed", {
			viewType,
			query: FilterUtils.deepCloneFilterQuery(query),
		});
	}

	/**
	 * Clear filter state for a specific view
	 */
	clearFilterState(viewType: string): void {
		delete this.filterState[viewType];
		this.saveToStorage();
		this.emit("filter-state-cleared", { viewType });
	}

	/**
	 * Clear all filter states
	 */
	clearAllFilterStates(): void {
		this.filterState = {};
		this.saveToStorage();
		this.emit("all-filter-states-cleared");
	}

	/**
	 * Get view preferences for a specific view
	 */
	getViewPreferences<T = any>(viewType: string): T | undefined {
		return this.viewPreferences[viewType];
	}

	/**
	 * Set view preferences for a specific view
	 */
	setViewPreferences<T = any>(viewType: string, preferences: T): void {
		this.viewPreferences[viewType] = { ...preferences };
		this.savePreferencesToStorage();
		this.emit("view-preferences-changed", { viewType, preferences });
	}

	/**
	 * Clear view preferences for a specific view
	 */
	clearViewPreferences(viewType: string): void {
		delete this.viewPreferences[viewType];
		this.savePreferencesToStorage();
		this.emit("view-preferences-cleared", { viewType });
	}

	/**
	 * Clear all view preferences
	 */
	clearAllViewPreferences(): void {
		this.viewPreferences = {};
		this.savePreferencesToStorage();
		this.emit("all-view-preferences-cleared");
	}

	/**
	 * Load state from localStorage
	 */
	private loadFromStorage(): void {
		try {
			const stored = this.app.loadLocalStorage(this.storageKey);
			if (stored && typeof stored === "string") {
				this.filterState = JSON.parse(stored);
			}
		} catch (error) {
			console.warn("Failed to load view filter state from storage:", error);
			this.filterState = {};
		}
	}

	/**
	 * Save state to localStorage
	 */
	private saveToStorage(): void {
		try {
			this.app.saveLocalStorage(this.storageKey, JSON.stringify(this.filterState));
		} catch (error) {
			console.warn("Failed to save view filter state to storage:", error);
		}
	}

	/**
	 * Load view preferences from localStorage
	 */
	private loadPreferencesFromStorage(): void {
		try {
			const stored = this.app.loadLocalStorage(this.preferencesStorageKey);
			if (stored && typeof stored === "string") {
				this.viewPreferences = JSON.parse(stored);
			}
		} catch (error) {
			console.warn("Failed to load view preferences from storage:", error);
			this.viewPreferences = {};
		}
	}

	/**
	 * Save view preferences to localStorage
	 */
	private savePreferencesToStorage(): void {
		try {
			this.app.saveLocalStorage(
				this.preferencesStorageKey,
				JSON.stringify(this.viewPreferences)
			);
		} catch (error) {
			console.warn("Failed to save view preferences to storage:", error);
		}
	}

	/**
	 * Get all filter states (for debugging or export)
	 */
	getAllFilterStates(): ViewFilterState {
		return { ...this.filterState };
	}

	/**
	 * Clean up event listeners and clear state
	 */
	cleanup(): void {
		// Remove all event listeners
		this.removeAllListeners();
	}
}
