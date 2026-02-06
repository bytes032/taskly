import { Platform } from "obsidian";
import TasklyPlugin from "../../main";
import {
	createSettingGroup,
	configureTextSetting,
	configureToggleSetting,
	configureNumberSetting,
} from "../components/settingHelpers";

/**
 * Renders the Integrations tab - external connections and API settings
 */
export function renderIntegrationsTab(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	container.empty();

	// HTTP API Section (Skip on mobile)
	if (!Platform.isMobile) {
		createSettingGroup(
			container,
			{
				heading: "HTTP API",
				description: "Enable HTTP API for external integrations and automations.",
			},
			(group) => {
				group.addSetting((setting) =>
					configureToggleSetting(setting, {
						name: "Enable HTTP API",
						desc: "Start local HTTP server for API access",
						getValue: () => plugin.settings.enableAPI,
						setValue: async (value: boolean) => {
							plugin.settings.enableAPI = value;
							save();
							// Re-render to show API settings
							renderIntegrationsTab(container, plugin, save);
						},
					})
				);

				if (plugin.settings.enableAPI) {
					group.addSetting((setting) =>
						configureNumberSetting(setting, {
							name: "API port",
							desc: "Port number for the HTTP API server",
							placeholder: "3000",
							min: 1024,
							max: 65535,
							getValue: () => plugin.settings.apiPort,
							setValue: async (value: number) => {
								plugin.settings.apiPort = value;
								save();
							},
						})
					);

					group.addSetting((setting) =>
						configureTextSetting(setting, {
							name: "API authentication token",
							desc: "Token required for API authentication (leave empty for no auth)",
							placeholder: "your-secret-token",
							getValue: () => plugin.settings.apiAuthToken,
							setValue: async (value: string) => {
								plugin.settings.apiAuthToken = value;
								save();
							},
						})
					);
				}
			}
		);
	}
}
