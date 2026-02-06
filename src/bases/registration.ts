/* eslint-disable no-console */
import TasklyPlugin from "../main";
import { requireApiVersion } from "obsidian";
import { buildTaskTableViewFactory } from "./views/TaskTableView";
import { registerBasesView, unregisterBasesView } from "./api";

/**
 * Register Taskly views with Bases plugin
 * Requires Obsidian 1.10.1+ (public Bases API with groupBy support)
 */
export async function registerBasesTaskList(plugin: TasklyPlugin): Promise<void> {
	// All views now require Obsidian 1.10.1+ (public Bases API with groupBy support)
	if (!requireApiVersion("1.10.1")) return;

	const attemptRegistration = async (): Promise<boolean> => {
		try {
			// Register Table view using public API
			const tableSuccess = registerBasesView(plugin, "tasklyTable", {
				name: "Taskly Table",
				icon: "table-2",
				factory: buildTaskTableViewFactory(plugin),
				options: () => [
					{
						type: "toggle",
						key: "showTableHeader",
						displayName: "Show column headers",
						default: true,
					},
					{
						type: "toggle",
						key: "enableSearch",
						displayName: "Enable search box",
						default: false,
					},
				],
			});

			// Consider it successful if any view registered successfully
			if (!tableSuccess) {
				console.debug("[Taskly][Bases] Bases plugin not available for registration");
				return false;
			}

			// Refresh existing Bases views
			plugin.app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.view?.getViewType?.() === "bases") {
					const view = leaf.view as any;
					if (typeof view.refresh === "function") {
						try {
							view.refresh();
						} catch (refreshError) {
							console.debug(
								"[Taskly][Bases] Error refreshing view:",
								refreshError
							);
						}
					}
				}
			});

			return true;
		} catch (error) {
			console.warn("[Taskly][Bases] Registration attempt failed:", error);
			return false;
		}
	};

	// Try immediate registration
	if (await attemptRegistration()) {
		return;
	}

	// If that fails, try a few more times with short delays
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 200));
		if (await attemptRegistration()) {
			return;
		}
	}

	console.warn("[Taskly][Bases] Failed to register views after multiple attempts");
}

/**
 * Unregister Taskly views from Bases plugin
 */
export function unregisterBasesViews(plugin: TasklyPlugin): void {
	try {
		// Unregister views using wrapper (uses internal API as public API doesn't provide unregister)
		unregisterBasesView(plugin, "tasklyTable");
	} catch (error) {
		console.error("[Taskly][Bases] Error during view unregistration:", error);
	}
}
