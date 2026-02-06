import TasklyPlugin from "../../main";
import {
	createSettingGroup,
	configureTextSetting,
	configureToggleSetting,
	configureDropdownSetting,
} from "../components/settingHelpers";
/**
 * Renders the General tab - foundational settings for task identification and storage
 */
export function renderGeneralTab(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	container.empty();

	// Tasks Storage Section
	createSettingGroup(
		container,
		{
			heading: "Task Storage",
			description: "Configure where tasks are stored and how they are identified.",
		},
		(group) => {
			group.addSetting((setting) =>
				configureTextSetting(setting, {
					name: "Default tasks folder",
					desc: "Default location for new tasks",
					placeholder: "Taskly",
					getValue: () => plugin.settings.tasksFolder,
					setValue: async (value: string) => {
						plugin.settings.tasksFolder = value;
						save();
					},
					ariaLabel: "Default folder path for new tasks",
				})
			);

			group.addSetting((setting) =>
				configureToggleSetting(setting, {
					name: "Move archived tasks to folder",
					desc: "Automatically move archived tasks to an archive folder",
					getValue: () => plugin.settings.moveArchivedTasks,
					setValue: async (value: boolean) => {
						plugin.settings.moveArchivedTasks = value;
						save();
						// Re-render to show/hide archive folder setting
						renderGeneralTab(container, plugin, save);
					},
				})
			);

			if (plugin.settings.moveArchivedTasks) {
				group.addSetting((setting) =>
					configureTextSetting(setting, {
						name: "Archive folder",
						desc: "Folder to move tasks to when archived. Supports template variables like {{year}}, {{month}}, {{date}}, and {{title}}.",
						placeholder: "_taskly/archive",
						getValue: () => plugin.settings.archiveFolder,
						setValue: async (value: string) => {
							plugin.settings.archiveFolder = value;
							save();
						},
						ariaLabel: "Archive folder path",
					})
				);
			}
		}
	);

	// Task Identification Section
	createSettingGroup(
		container,
		{
			heading: "Task Identification",
			description: "Choose how Taskly identifies notes as tasks.",
		},
		(group) => {
			group.addSetting((setting) =>
				configureDropdownSetting(setting, {
					name: "Identify tasks by",
					desc: "Choose whether to identify tasks by tag or by a frontmatter property",
					options: [
						{
							value: "tag",
							label: "Tag",
						},
						{
							value: "property",
							label: "Property",
						},
					],
					getValue: () => plugin.settings.taskIdentificationMethod,
					setValue: async (value: string) => {
						plugin.settings.taskIdentificationMethod = value as "tag" | "property";
						save();
						// Re-render to show/hide conditional fields
						renderGeneralTab(container, plugin, save);
					},
					ariaLabel: "Task identification method",
				})
			);

			if (plugin.settings.taskIdentificationMethod === "tag") {
				group.addSetting((setting) =>
					configureTextSetting(setting, {
						name: "Task tag",
						desc: "Tag that identifies notes as tasks (without #). This tag is automatically hidden in task card displays.",
						placeholder: "task",
						getValue: () => plugin.settings.taskTag,
						setValue: async (value: string) => {
							plugin.settings.taskTag = value;
							save();
						},
						ariaLabel: "Task identification tag",
					})
				);
			} else {
				group.addSetting((setting) =>
					configureTextSetting(setting, {
						name: "Task property name",
						desc: "The frontmatter property name (e.g., \"category\")",
						placeholder: "category",
						getValue: () => plugin.settings.taskPropertyName,
						setValue: async (value: string) => {
							plugin.settings.taskPropertyName = value;
							save();
						},
					})
				);

				group.addSetting((setting) =>
					configureTextSetting(setting, {
						name: "Task property value",
						desc: "The value that identifies a note as a task (e.g., \"task\")",
						placeholder: "task",
						getValue: () => plugin.settings.taskPropertyValue,
						setValue: async (value: string) => {
							plugin.settings.taskPropertyValue = value;
							save();
						},
					})
				);
			}
		}
	);

	// Folder Management Section
	createSettingGroup(
		container,
		{ heading: "Folder Management" },
		(group) => {
			group.addSetting((setting) =>
				configureTextSetting(setting, {
					name: "Excluded folders",
					desc: "Comma-separated list of folders to exclude from task indexing and file suggestions",
					placeholder: "Templates, Archive",
					getValue: () => plugin.settings.excludedFolders,
					setValue: async (value: string) => {
						plugin.settings.excludedFolders = value;
						save();
					},
					ariaLabel: "Excluded folder paths",
				})
			);
		}
	);

}
