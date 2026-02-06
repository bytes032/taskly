import { Notice } from "obsidian";
import TasklyPlugin from "../../main";
import {
	createSettingGroup,
	configureTextSetting,
	configureToggleSetting,
	configureDropdownSetting,
} from "../components/settingHelpers";
import { PropertySelectorModal } from "../../modals/PropertySelectorModal";
import { getAvailableProperties, getPropertyLabels } from "../../utils/propertyHelpers";
import { formatString } from "../../utils/stringFormat";

/**
 * Renders the Features tab - optional plugin modules and their configuration
 */
export function renderFeaturesTab(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	container.empty();

	// Inline Tasks Section
	const availableProperties = getAvailableProperties(plugin);
	const currentInlineProperties = plugin.settings.inlineVisibleProperties || [
		"status", "due", "recurrence",
	];
	const currentInlineLabels = getPropertyLabels(plugin, currentInlineProperties);

	createSettingGroup(
		container,
		{
			heading: "Inline Tasks",
			description: "Settings for task links and checkbox-to-task conversion in notes.",
		},
		(group) => {
			group.addSetting((setting) =>
				configureToggleSetting(setting, {
					name: "Task link overlay",
					desc: "Show interactive overlays when hovering over task links",
					getValue: () => plugin.settings.enableTaskLinkOverlay,
					setValue: async (value: boolean) => {
						plugin.settings.enableTaskLinkOverlay = value;
						save();
						renderFeaturesTab(container, plugin, save);
					},
				})
			);

			if (plugin.settings.enableTaskLinkOverlay) {
				group.addSetting((setting) =>
					configureToggleSetting(setting, {
						name: "Disable overlay for aliased links",
						desc: "Do not show the task widget if the link contains an alias (e.g. [[Task|Alias]]).",
						getValue: () => plugin.settings.disableOverlayOnAlias,
						setValue: async (value: boolean) => {
							plugin.settings.disableOverlayOnAlias = value;
							save();
						},
					})
				);

				group.addSetting((setting) => {
					setting
						.setName("Inline Task Card Properties")
						.setDesc("Select which properties to show in inline task cards.")
						.addButton((button) => {
							button.setButtonText("Configure").onClick(() => {
								const modal = new PropertySelectorModal(
									plugin.app,
									availableProperties,
									currentInlineProperties,
									async (selected) => {
										plugin.settings.inlineVisibleProperties = selected;
										save();
										new Notice("Inline task card properties updated");
										renderFeaturesTab(container, plugin, save);
									},
									"Select Inline Task Card Properties",
									"Choose which properties to display in inline task cards."
								);
								modal.open();
							});
						});
				});

				group.addSetting((setting) => {
					setting.setDesc(`Currently showing: ${currentInlineLabels.join(", ")}`);
					setting.settingEl.addClass("settings-view__group-description");
				});
			}

			group.addSetting((setting) =>
				configureToggleSetting(setting, {
					name: "Show convert button next to checkboxes",
					desc: "Display an inline button next to Markdown checkboxes that converts them to Taskly",
					getValue: () => plugin.settings.enableInstantTaskConvert,
					setValue: async (value: boolean) => {
						plugin.settings.enableInstantTaskConvert = value;
						save();
						renderFeaturesTab(container, plugin, save);
					},
				})
			);

			// Show folder setting when instant convert is enabled
			if (plugin.settings.enableInstantTaskConvert) {
				group.addSetting((setting) =>
					configureTextSetting(setting, {
						name: "Folder for converted tasks",
						desc: "Folder where tasks converted from checkboxes will be created. Leave empty to use the default tasks folder. Use {{currentNotePath}} for the current note's folder, or {{currentNoteTitle}} for a subfolder named after the current note.",
						placeholder: "{{currentNotePath}}",
						getValue: () => plugin.settings.inlineTaskConvertFolder,
						setValue: async (value: string) => {
							plugin.settings.inlineTaskConvertFolder = value;
							save();
						},
						ariaLabel: "Folder for converted inline tasks",
					})
				);

				group.addSetting((setting) =>
					configureToggleSetting(setting, {
						name: "Use task defaults on instant convert",
						desc: "Apply default task settings when converting text to tasks instantly",
						getValue: () => plugin.settings.useDefaultsOnInstantConvert,
						setValue: async (value: boolean) => {
							plugin.settings.useDefaultsOnInstantConvert = value;
							save();
						},
					})
				);
			}
		}
	);

	// Notifications Section
	createSettingGroup(
		container,
		{
			heading: "Notifications",
			description: "Configure task reminder notifications and alerts.",
		},
		(group) => {
			group.addSetting((setting) =>
				configureToggleSetting(setting, {
					name: "Enable notifications",
					desc: "Enable task reminder notifications",
					getValue: () => plugin.settings.enableNotifications,
					setValue: async (value: boolean) => {
						plugin.settings.enableNotifications = value;
						save();
						renderFeaturesTab(container, plugin, save);
					},
				})
			);

			if (plugin.settings.enableNotifications) {
				group.addSetting((setting) =>
					configureDropdownSetting(setting, {
						name: "Notification type",
						desc: "Type of notifications to show",
						options: [
							{ value: "in-app", label: "In-app notifications" },
							{ value: "system", label: "System notifications" },
						],
						getValue: () => plugin.settings.notificationType,
						setValue: async (value: string) => {
							plugin.settings.notificationType = value as "in-app" | "system";
							save();
						},
					})
				);
			}
		}
	);

	// Views & Base Files Section
	const commandMappings = [
		{
			id: 'open-table-view',
			name: "Open table view",
			defaultPath: '_taskly/views/table-default.base',
		},
	];

	createSettingGroup(
		container,
		{
			heading: "Views & Base Files",
			description: "Taskly uses Obsidian Bases files (.base) to power its views. These files are generated automatically on startup if they don't exist.",
		},
		(group) => {
			group.addSetting((setting) => {
				setting.setDesc("Base files are not automatically updated when you change settings. To apply new settings, delete the existing .base files and restart Obsidian, or edit them manually.");
				setting.settingEl.addClass("settings-view__group-description");
			});

			group.addSetting((setting) =>
				configureToggleSetting(setting, {
					name: "Enable SWR cache for Bases views",
					desc: "Show cached table rows instantly while Bases loads fresh data.",
					getValue: () => plugin.settings.enableBasesSWR,
					setValue: async (value: boolean) => {
						plugin.settings.enableBasesSWR = value;
						await save();
					},
				})
			);

			commandMappings.forEach(({ id, name, defaultPath }) => {
				group.addSetting((setting) => {
					setting.setName(name);
					setting.setDesc(formatString("File: {path}", {
						path: plugin.settings.commandFileMapping[id]
					}));

					setting.addText(text => {
						text.setPlaceholder(defaultPath)
							.setValue(plugin.settings.commandFileMapping[id])
							.onChange(async (value) => {
								plugin.settings.commandFileMapping[id] = value;
								await save();
								setting.setDesc(formatString("File: {path}", {
									path: value
								}));
							});
						text.inputEl.style.width = '100%';
						return text;
					});

					setting.addButton(button => {
						button.setButtonText("Reset")
							.setTooltip("Reset to default path")
							.onClick(async () => {
								plugin.settings.commandFileMapping[id] = defaultPath;
								await save();
								renderFeaturesTab(container, plugin, save);
							});
						return button;
					});
				});
			});
		}
	);
}
