import { Notice } from "obsidian";
import TasklyPlugin from "../../main";
import {
	createSettingGroup,
	configureToggleSetting,
	configureDropdownSetting,
} from "../components/settingHelpers";
import { PropertySelectorModal } from "../../modals/PropertySelectorModal";
import { getAvailableProperties, getPropertyLabels } from "../../utils/propertyHelpers";

/**
 * Renders the Appearance & UI tab - visual customization settings
 */
export function renderAppearanceTab(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	container.empty();

	// Task Cards Section
	const availableProperties = getAvailableProperties(plugin);
	const currentProperties = plugin.settings.defaultVisibleProperties || [];
	const currentLabels = getPropertyLabels(plugin, currentProperties);

	createSettingGroup(
		container,
		{
			heading: "Task Cards",
			description: "Configure how task cards are displayed across all views.",
		},
		(group) => {
			group.addSetting((setting) => {
				setting
					.setName("Default visible properties")
					.setDesc("Choose which properties appear on task cards by default.")
					.addButton((button) => {
						button.setButtonText("Configure").onClick(() => {
							const modal = new PropertySelectorModal(
								plugin.app,
								availableProperties,
								currentProperties,
								async (selected) => {
									plugin.settings.defaultVisibleProperties = selected;
									save();
									new Notice("Default task card properties updated");
									// Re-render to update display
									renderAppearanceTab(container, plugin, save);
								},
								"Select Default Task Card Properties",
								"Choose which properties to display in task cards. Selected properties will appear in the order shown below."
							);
							modal.open();
						});
					});
			});

			// Show currently selected properties
			group.addSetting((setting) => {
				setting.setDesc(`Currently showing: ${currentLabels.join(", ")}`);
				setting.settingEl.addClass("settings-view__group-description");
			});
		}
	);

	// Display Formatting Section
	createSettingGroup(
		container,
		{
			heading: "Display Formatting",
			description: "Configure how dates, times, and other data are displayed across the plugin.",
		},
		(group) => {
			group.addSetting((setting) =>
				configureDropdownSetting(setting, {
					name: "Time format",
					desc: "Display time in 12-hour or 24-hour format throughout the plugin",
					options: [
						{
							value: "12",
							label: "12-hour (AM/PM)",
						},
						{
							value: "24",
							label: "24-hour",
						},
					],
					getValue: () => plugin.settings.timeFormat,
					setValue: async (value: string) => {
						plugin.settings.timeFormat = value as "12" | "24";
						save();
					},
				})
			);
		}
	);

	// Task Interaction Section
	createSettingGroup(
		container,
		{
			heading: "Task Interaction",
			description: "Configure how clicking on tasks behaves.",
		},
		(group) => {
			group.addSetting((setting) =>
				configureDropdownSetting(setting, {
					name: "Single-click action",
					desc: "Action performed when single-clicking a task card",
					options: [
						{ value: "openNote", label: "Open note" },
						{ value: "none", label: "No action" },
					],
					getValue: () => plugin.settings.singleClickAction,
					setValue: async (value: string) => {
						plugin.settings.singleClickAction = value as "openNote" | "none";
						save();
					},
				})
			);

			group.addSetting((setting) =>
				configureDropdownSetting(setting, {
					name: "Double-click action",
					desc: "Action performed when double-clicking a task card",
					options: [
						{ value: "openNote", label: "Open note" },
						{ value: "none", label: "No action" },
					],
					getValue: () => plugin.settings.doubleClickAction,
					setValue: async (value: string) => {
						plugin.settings.doubleClickAction = value as "openNote" | "none";
						save();
					},
				})
			);

			group.addSetting((setting) =>
				configureToggleSetting(setting, {
					name: "Hide completed tasks from overdue",
					desc: "Exclude completed tasks from overdue task calculations",
					getValue: () => plugin.settings.hideCompletedFromOverdue,
					setValue: async (value: boolean) => {
						plugin.settings.hideCompletedFromOverdue = value;
						save();
					},
				})
			);
		}
	);
}
