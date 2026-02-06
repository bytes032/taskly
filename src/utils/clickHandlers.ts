import { TaskInfo } from "../types";
import TasklyPlugin from "../main";

export interface ClickHandlerOptions {
	task: TaskInfo;
	plugin: TasklyPlugin;
	excludeSelector?: string; // CSS selector for elements that should not trigger click behavior
	onSingleClick?: (e: MouseEvent) => Promise<void>; // Optional override for single click
	onDoubleClick?: (e: MouseEvent) => Promise<void>; // Optional override for double click
	contextMenuHandler?: (e: MouseEvent) => Promise<void>; // Optional context menu handler
}

/**
 * Creates a reusable click handler for task cards.
 * - Single click: Uses configured action
 * - Double click: Uses configured action (or disabled)
 * - Shift+click: Multi-selection mode
 * - Status dot click: Handled separately (toggles completion)
 */
export function createTaskClickHandler(options: ClickHandlerOptions) {
	const { task, plugin, excludeSelector, onSingleClick, onDoubleClick, contextMenuHandler } =
		options;

	const openTaskNote = async (_newTab = false) => {
		const file = plugin.app.vault.getAbstractFileByPath(task.path);
		if (file) {
			const leaf = plugin.app.workspace.getLeaf("split", "vertical");
			await leaf.openFile(file as import("obsidian").TFile);
		}
	};

	const handleSingleClick = async (e: MouseEvent) => {
		if (onSingleClick) {
			await onSingleClick(e);
			return;
		}

		if (e.ctrlKey || e.metaKey) {
			await openTaskNote(true);
			return;
		}

		switch (plugin.settings.singleClickAction) {
			case "openNote":
				await openTaskNote(false);
				break;
			default:
				break;
		}
	};

	const handleDoubleClick = async (e: MouseEvent) => {
		if (onDoubleClick) {
			await onDoubleClick(e);
			return;
		}

		switch (plugin.settings.doubleClickAction) {
			case "openNote":
				await openTaskNote(false);
				break;
			default:
				break;
		}
	};

	const hasDoubleClickAction =
		Boolean(onDoubleClick) || plugin.settings.doubleClickAction !== "none";
	let clickTimeout: number | null = null;

	const clearClickTimeout = (win: Window) => {
		if (clickTimeout !== null) {
			win.clearTimeout(clickTimeout);
			clickTimeout = null;
		}
	};

	const clickHandler = async (e: MouseEvent) => {
		if (excludeSelector) {
			const target = e.target as HTMLElement;
			if (target.closest(excludeSelector)) {
				return;
			}
		}

		// Check for selection mode - only shift+click triggers selection
		const selectionService = plugin.taskSelectionService;
		if (selectionService) {
			if (e.shiftKey) {
				e.stopPropagation();

				// Enter selection mode if not already active
				if (!selectionService.isSelectionModeActive()) {
					selectionService.enterSelectionMode();
				}

				// Toggle selection for this task
				selectionService.toggleSelection(task.path);
				return;
			}

			// Regular click without shift exits selection mode
			if (selectionService.isSelectionModeActive()) {
				selectionService.clearSelection();
				selectionService.exitSelectionMode();
			}
		}

		// Stop propagation to prevent clicks from bubbling to parent cards
		e.stopPropagation();

		if (!hasDoubleClickAction) {
			await handleSingleClick(e);
			return;
		}

		const win = (e.currentTarget as HTMLElement | null)?.ownerDocument?.defaultView || window;
		clearClickTimeout(win);
		clickTimeout = win.setTimeout(async () => {
			clickTimeout = null;
			await handleSingleClick(e);
		}, 250);
	};

	const dblclickHandler = async (e: MouseEvent) => {
		if (!hasDoubleClickAction) {
			return;
		}

		if (excludeSelector) {
			const target = e.target as HTMLElement;
			if (target.closest(excludeSelector)) {
				return;
			}
		}

		const win = (e.currentTarget as HTMLElement | null)?.ownerDocument?.defaultView || window;
		clearClickTimeout(win);
		e.stopPropagation();
		await handleDoubleClick(e);
	};

	const contextmenuHandler = async (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation(); // Prevent event from bubbling to parent cards

		const selectionService = plugin.taskSelectionService;

		// Shift+right-click adds to selection and opens batch context menu
		if (e.shiftKey && selectionService) {
			if (!selectionService.isSelectionModeActive()) {
				selectionService.enterSelectionMode();
			}
			if (!selectionService.isSelected(task.path)) {
				selectionService.addToSelection(task.path);
			}

			// Show batch context menu if we have selections
			if (selectionService.getSelectionCount() > 0) {
				const { BatchContextMenu } = require("../components/BatchContextMenu");
				const menu = new BatchContextMenu({
					plugin,
					selectedPaths: selectionService.getSelectedPaths(),
					onUpdate: () => {},
				});
				menu.show(e);
			}
			return;
		}

		// Check if multiple tasks are selected - show batch context menu
		if (selectionService && selectionService.getSelectionCount() > 1) {
			// Ensure the right-clicked task is in the selection
			if (!selectionService.isSelected(task.path)) {
				selectionService.addToSelection(task.path);
			}

			// Import and show batch context menu
			const { BatchContextMenu } = require("../components/BatchContextMenu");
			const menu = new BatchContextMenu({
				plugin,
				selectedPaths: selectionService.getSelectedPaths(),
				onUpdate: () => {
					// Views will refresh via events
				},
			});
			menu.show(e);
			return;
		}

		// Opening a single-task context menu exits selection mode
		if (selectionService?.isSelectionModeActive()) {
			selectionService.clearSelection();
			selectionService.exitSelectionMode();
		}

		if (contextMenuHandler) {
			await contextMenuHandler(e);
		}
	};

	return {
		clickHandler,
		dblclickHandler,
		contextmenuHandler,
		cleanup: () => {},
	};
}

/**
 * Creates a standard hover preview handler for task elements
 */
export function createTaskHoverHandler(task: TaskInfo, plugin: TasklyPlugin) {
	return (event: MouseEvent) => {
		const file = plugin.app.vault.getAbstractFileByPath(task.path);
		if (file) {
			plugin.app.workspace.trigger("hover-link", {
				event,
				source: "taskly-task-card",
				hoverParent: event.currentTarget as HTMLElement,
				targetEl: event.currentTarget as HTMLElement,
				linktext: task.path,
				sourcePath: task.path,
			});
		}
	};
}
