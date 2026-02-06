/* eslint-disable @typescript-eslint/no-non-null-assertion */
import TasklyPlugin from "../../main";
import { BaseTaskView } from "./BaseTaskView";

/**
 * TaskTableView - A table/spreadsheet-style view for tasks.
 * Extends BaseTaskView with table layout always enabled.
 *
 * Displays tasks in a single-row format with columns:
 * Status | Name | Tags | Date Added
 */
export class TaskTableView extends BaseTaskView {
	type = "tasklyTable";

	constructor(controller: any, containerEl: HTMLElement, plugin: TasklyPlugin) {
		super(controller, containerEl, plugin);
		// Enable table layout by default
		this.useTableLayout = true;
		this.showTableHeader = true;
	}
}

/**
 * Factory function for Bases registration.
 * Returns an actual TaskTableView instance (extends BasesView).
 */
export function buildTaskTableViewFactory(plugin: TasklyPlugin) {
	return function (controller: any, containerEl: HTMLElement): TaskTableView {
		if (!containerEl) {
			console.error("[Taskly][TaskTableView] No containerEl provided");
			throw new Error("TaskTableView requires a containerEl");
		}

		return new TaskTableView(controller, containerEl, plugin);
	};
}
