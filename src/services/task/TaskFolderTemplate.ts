import { TaskCreationData } from "../../types";
import { processFolderTemplate, TaskTemplateData } from "../../utils/folderTemplateProcessor";

/**
 * Process a folder path template with task and date variables.
 *
 * Supported task variables:
 * - {{status}} - Task status (e.g., "open", "done")
 * - {{title}} - Task title (sanitized for folder names)
 *
 * Supported date variables:
 * - {{year}} - Current year (e.g., "2025")
 * - {{month}} - Current month with leading zero (e.g., "08")
 * - {{day}} - Current day with leading zero (e.g., "15")
 * - {{date}} - Full current date (e.g., "2025-08-15")
 */
export function processTaskFolderTemplate(
	folderTemplate: string,
	taskData?: TaskCreationData,
	date: Date = new Date()
): string {
	const templateData: TaskTemplateData | undefined = taskData
		? {
			title: taskData.title,
			status: taskData.status,
			due: taskData.due,
		}
		: undefined;

	return processFolderTemplate(folderTemplate, {
		date,
		taskData: templateData,
	});
}
