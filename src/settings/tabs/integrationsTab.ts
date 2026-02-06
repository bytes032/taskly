import { Notice, Platform, Modal, Setting, setIcon, App } from "obsidian";
import TasklyPlugin from "../../main";
import { WebhookConfig, WebhookEvent } from "../../types";
import {
	createSettingGroup,
	configureTextSetting,
	configureToggleSetting,
	configureNumberSetting,
	configureButtonSetting,
} from "../components/settingHelpers";
import { showConfirmationModal } from "../../modals/ConfirmationModal";
import {
	createCard,
	createStatusBadge,
	createCardToggle,
	createDeleteHeaderButton,
	createCardUrlInput,
	createInfoBadge,
	showCardEmptyState,
} from "../components/CardComponent";

import { formatString } from "../../utils/stringFormat";
/**
 * Helper function to format relative time (e.g., "2 hours ago", "5 minutes ago")
 */
function getRelativeTime(
	date: Date
): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffSeconds = Math.floor(diffMs / 1000);
	const diffMinutes = Math.floor(diffSeconds / 60);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays > 0) {
		return formatString("{days} day{plural} ago",  {
			days: diffDays,
			plural: diffDays > 1 ? "s" : "",
		});
	} else if (diffHours > 0) {
		return formatString("{hours} hour{plural} ago",  {
			hours: diffHours,
			plural: diffHours > 1 ? "s" : "",
		});
	} else if (diffMinutes > 0) {
		return formatString("{minutes} minute{plural} ago",  {
			minutes: diffMinutes,
			plural: diffMinutes > 1 ? "s" : "",
		});
	} else {
		return "Just now";
	}
}

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

		// API endpoint documentation removed.
	}

	// Webhooks Section
	renderWebhookList(container, plugin, save);

	createSettingGroup(
		container,
		{
			heading: "Webhooks",
			description:
				"Webhooks send real-time notifications to external services when Taskly events occur." +
				" " +
				"Configure webhooks to integrate with automation tools, sync services, or custom applications.",
		},
		(group) => {
			// Add webhook button
			group.addSetting((setting) =>
				configureButtonSetting(setting, {
					name: "Add Webhook",
					desc: "Register a new webhook endpoint",
					buttonText: "Add Webhook",
					onClick: async () => {
						const modal = new WebhookModal(
							plugin.app,
							async (webhookConfig: Partial<WebhookConfig>) => {
								// Generate ID and secret
								const webhook: WebhookConfig = {
									id: `wh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
									url: webhookConfig.url || "",
									events: webhookConfig.events || [],
									secret: generateWebhookSecret(),
									active: true,
									createdAt: new Date().toISOString(),
									failureCount: 0,
									successCount: 0,
									transformFile: webhookConfig.transformFile,
									corsHeaders: webhookConfig.corsHeaders,
								};

								if (!plugin.settings.webhooks) {
									plugin.settings.webhooks = [];
								}

								plugin.settings.webhooks.push(webhook);
								save();

								// Re-render webhook list to show the new webhook
								renderWebhookList(
									container.querySelector(".taskly-webhooks-container")
										?.parentElement || container,
									plugin,
									save
								);

								// Show success message with secret
								new SecretNoticeModal(plugin.app, webhook.secret).open();
								new Notice("Webhook created successfully");
							}
						);
						modal.open();
					},
				})
			);
		}
	);
}

function renderWebhookList(
	container: HTMLElement,
	plugin: TasklyPlugin,
	save: () => void
): void {
	// Clear existing webhook content
	const existingContainer = container.querySelector(".taskly-webhooks-container");
	if (existingContainer) {
		existingContainer.remove();
	}

	const webhooksContainer = container.createDiv("taskly-webhooks-container");

	if (!plugin.settings.webhooks || plugin.settings.webhooks.length === 0) {
		showCardEmptyState(
			webhooksContainer,
			"No webhooks configured. Add a webhook to receive real-time notifications.",
			"Add Webhook",
			() => {
				// This is a bit of a hack, but it's the easiest way to trigger the add webhook modal
				const addWebhookButton = container
					.closest(".settings-tab-content")
					?.querySelector("button.tn-btn--primary");
				if (addWebhookButton) {
					(addWebhookButton as HTMLElement).click();
				}
			}
		);
		return;
	}

	plugin.settings.webhooks.forEach((webhook, index) => {
		const statusBadge = createStatusBadge(
			webhook.active ? "Active" : "Inactive",
			webhook.active ? "active" : "inactive"
		);

		const successBadge = createInfoBadge(`Success: ${webhook.successCount || 0}`);
		const failureBadge = createInfoBadge(`Failed: ${webhook.failureCount || 0}`);

		// Create inputs for inline editing
		const urlInput = createCardUrlInput("Webhook URL", webhook.url);
		const activeToggle = createCardToggle(webhook.active, (value) => {
			webhook.active = value;
			save();

			// Update the status badge in place instead of re-rendering entire list
			const card = activeToggle.closest(".taskly-settings__card");
			if (card) {
				const statusBadge = card.querySelector(
					".taskly-settings__card-status-badge--active, .taskly-settings__card-status-badge--inactive"
				);
				if (statusBadge) {
					statusBadge.textContent = webhook.active ? "Active" : "Inactive";
					statusBadge.className = webhook.active
						? "taskly-settings__card-status-badge taskly-settings__card-status-badge--active"
						: "taskly-settings__card-status-badge taskly-settings__card-status-badge--inactive";
				}

				// Update test button disabled state
				const testButton = card.querySelector('[aria-label*="Test"]') as HTMLButtonElement;
				if (testButton) {
					testButton.disabled = !webhook.active || !webhook.url;
				}
			}

			new Notice(
				webhook.active
					? "Webhook enabled"
					: "Webhook disabled"
			);
		});

		// Update handler for URL input
		urlInput.addEventListener("blur", () => {
			if (urlInput.value.trim() !== webhook.url) {
				webhook.url = urlInput.value.trim();
				save();
				new Notice("Webhook URL updated");
			}
		});

		// Format webhook creation date
		const createdDate = webhook.createdAt ? new Date(webhook.createdAt) : null;
		const createdText = createdDate
			? formatString("Created {timeAgo}",  {
					timeAgo: getRelativeTime(createdDate),
				})
			: "Creation date unknown";

		// Create events display as a formatted string
		const eventsDisplay = document.createElement("div");
		eventsDisplay.className = "taskly-webhook-events";

		if (webhook.events.length === 0) {
			const noEventsSpan = document.createElement("span");
			noEventsSpan.className = "taskly-webhook-events--empty";
			noEventsSpan.textContent = "No events selected";
			eventsDisplay.appendChild(noEventsSpan);
		} else {
			webhook.events.forEach((event) => {
				eventsDisplay.appendChild(createInfoBadge(event));
			});
		}

		// Create transform file display if exists
		const transformDisplay = document.createElement("span");
		if (webhook.transformFile) {
			transformDisplay.className = "taskly-transform-file";
			transformDisplay.textContent = webhook.transformFile;
		} else {
			transformDisplay.className = "taskly-transform-file--empty";
			transformDisplay.textContent = "Raw payload (no transform)";
		}

		createCard(webhooksContainer, {
			id: webhook.id,
			collapsible: true,
			defaultCollapsed: true,
			header: {
				primaryText: "Webhook",
				secondaryText: createdText,
				meta: [statusBadge, successBadge, failureBadge],
				actions: [
					createDeleteHeaderButton(async () => {
						const confirmed = await showConfirmationModal(plugin.app, {
							title: "Delete Webhook",
							message: formatString("Are you sure you want to delete this webhook?\n\nURL: {url}\n\nThis action cannot be undone.", 
								{ url: webhook.url }),
							confirmText: "Delete",
							cancelText: "Cancel",
							isDestructive: true,
						});

						if (confirmed) {
							plugin.settings.webhooks.splice(index, 1);
							save();
							renderWebhookList(container, plugin, save);
							new Notice("Webhook deleted");
						}
					}),
				],
			},
			content: {
				sections: [
					{
						rows: [
							{
								label: "Active:",
								input: activeToggle,
							},
							{
								label: "URL:",
								input: urlInput,
							},
							{
								label: "Events:",
								input: eventsDisplay,
							},
							{
								label: "Transform:",
								input: transformDisplay,
							},
						],
					},
				],
			},
			actions: {
				buttons: [
					{
						text: "Edit Events",
						icon: "settings",
						variant: "secondary",
						onClick: async () => {
							const modal = new WebhookEditModal(
								plugin.app,
								webhook,
								async (updatedConfig: Partial<WebhookConfig>) => {
									Object.assign(webhook, updatedConfig);
									save();
									renderWebhookList(container, plugin, save);
									new Notice(
										"Webhook updated"
									);
								}
							);
							modal.open();
						},
					},
				],
			},
		});
	});
}

/**
 * Generate secure webhook secret
 */
function generateWebhookSecret(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(32)))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Modal for displaying webhook secret after creation
 */
class SecretNoticeModal extends Modal {
	private secret: string;

	constructor(app: App, secret: string) {
		super(app);
		this.secret = secret;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("taskly-webhook-modal");

		const notice = contentEl.createDiv({ cls: "taskly-webhook-secret-notice" });

		const title = notice.createDiv({ cls: "taskly-webhook-secret-title" });
		const titleIcon = title.createSpan();
		setIcon(titleIcon, "shield-check");
		title.createSpan({ text: "Webhook Secret Generated" });

		const content = notice.createDiv({ cls: "taskly-webhook-secret-content" });
		content.createDiv({
			text: "Your webhook secret has been generated. Save this secret as you won't be able to view it again:",
		});
		content.createEl("code", { text: this.secret, cls: "taskly-webhook-secret-code" });
		content.createDiv({
			text: "Use this secret to verify webhook payloads in your receiving application.",
		});

		const buttonContainer = contentEl.createDiv({ cls: "taskly-webhook-modal-buttons" });
		const closeButton = buttonContainer.createEl("button", {
			text: "Close",
			cls: "taskly-webhook-modal-btn save",
			attr: { "aria-label": "Close webhook secret modal" },
		});

		closeButton.addEventListener("click", () => this.close());
	}
}

/**
 * Modal for editing existing webhooks
 */
class WebhookEditModal extends Modal {
	private webhook: WebhookConfig;
	private selectedEvents: WebhookEvent[];
	private transformFile: string;
	private corsHeaders: boolean;
	private onSubmit: (config: Partial<WebhookConfig>) => void;

	constructor(
		app: App,
		webhook: WebhookConfig,
		onSubmit: (config: Partial<WebhookConfig>) => void
	) {
		super(app);
		this.webhook = webhook;
		this.selectedEvents = [...webhook.events];
		this.transformFile = webhook.transformFile || "";
		this.corsHeaders = webhook.corsHeaders ?? true;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("taskly-webhook-modal");

		const header = contentEl.createDiv({ cls: "taskly-webhook-modal-header" });
		const headerIcon = header.createSpan({ cls: "taskly-webhook-modal-icon" });
		setIcon(headerIcon, "webhook");
		header.createEl("h2", { text: "Edit Webhook", cls: "taskly-webhook-modal-title" });

		// Events selection section
		const eventsSection = contentEl.createDiv({ cls: "taskly-webhook-modal-section" });
		eventsSection.createDiv({
			text: "Events to send:",
			cls: "taskly-webhook-modal-subsection-header",
		});

		const eventsGrid = eventsSection.createDiv({ cls: "taskly-webhook-events-list" });
		const availableEvents: WebhookEvent[] = [
			"task.created",
			"task.updated",
			"task.completed",
			"task.archived",
			"task.deleted",
		];

		availableEvents.forEach((event) => {
			const eventItem = eventsGrid.createDiv({ cls: "taskly-webhook-event-item" });
			const checkbox = eventItem.createEl("input", { type: "checkbox" });
			checkbox.checked = this.selectedEvents.includes(event);

			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selectedEvents.push(event);
				} else {
					this.selectedEvents = this.selectedEvents.filter((e) => e !== event);
				}
			});

			const label = eventItem.createEl("span", { text: event });
			label.addEventListener("click", () => {
				checkbox.checked = !checkbox.checked;
				checkbox.dispatchEvent(new Event("change"));
			});
		});

		// Transform file section
		const transformSection = contentEl.createDiv({ cls: "taskly-webhook-modal-section" });
		transformSection.createDiv({
			text: "Transform File (Optional)",
			cls: "taskly-webhook-modal-subsection-header",
		});

		new Setting(transformSection)
			.setName("Transform file path")
			.setDesc("Path to a .js or .json file in your vault that transforms webhook payloads")
			.addText((text) => {
				text
					.setPlaceholder("e.g., scripts/transform.js")
					.setValue(this.transformFile)
					.onChange((value) => {
						this.transformFile = value;
					});
			});

		// CORS headers toggle section
		const corsSection = contentEl.createDiv({ cls: "taskly-webhook-modal-section" });
		corsSection.createDiv({
			text: "CORS Headers",
			cls: "taskly-webhook-modal-subsection-header",
		});

		new Setting(corsSection)
			.setName("Enable CORS headers")
			.setDesc("Include CORS headers in webhook requests")
			.addToggle((toggle) => {
				toggle.setValue(this.corsHeaders).onChange((value) => {
					this.corsHeaders = value;
				});
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "taskly-webhook-modal-buttons" });
		const cancelBtn = buttonContainer.createEl("button", {
			text: "Cancel",
			cls: "taskly-webhook-modal-btn cancel",
			attr: { "aria-label": "Cancel webhook editing" },
		});
		const cancelIcon = cancelBtn.createSpan({ cls: "taskly-webhook-modal-btn-icon" });
		setIcon(cancelIcon, "x");

		const saveBtn = buttonContainer.createEl("button", {
			text: "Save Changes",
			cls: "taskly-webhook-modal-btn save mod-cta",
			attr: { "aria-label": "Save webhook changes" },
		});
		const saveIcon = saveBtn.createSpan({ cls: "taskly-webhook-modal-btn-icon" });
		setIcon(saveIcon, "save");

		cancelBtn.addEventListener("click", () => this.close());
		saveBtn.addEventListener("click", () => {
			this.onSubmit({
				events: this.selectedEvents,
				transformFile: this.transformFile.trim() || undefined,
				corsHeaders: this.corsHeaders,
			});
			this.close();
		});
	}
}

/**
 * Modal for adding/editing webhooks
 */
class WebhookModal extends Modal {
	private selectedEvents: WebhookEvent[] = [];
	private transformFile: string = "";
	private corsHeaders: boolean = true;
	private onSubmit: (config: Partial<WebhookConfig>) => void;

	constructor(app: App, onSubmit: (config: Partial<WebhookConfig>) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("taskly-webhook-modal");

		const header = contentEl.createDiv({ cls: "taskly-webhook-modal-header" });
		const headerIcon = header.createSpan({ cls: "taskly-webhook-modal-icon" });
		setIcon(headerIcon, "webhook");
		header.createEl("h2", { text: "Add Webhook", cls: "taskly-webhook-modal-title" });

		// URL section
		const urlSection = contentEl.createDiv({ cls: "taskly-webhook-modal-section" });
		new Setting(urlSection)
			.setName("Webhook URL")
			.setDesc("The endpoint where webhook payloads will be sent")
			.addText((text) => {
				text.inputEl.setAttribute("aria-label", "Webhook URL");
				text
					.setPlaceholder("https://your-service.com/webhook")
					.onChange((value) => {
						this.webhookUrl = value;
					});
			});

		// Events selection section
		const eventsSection = contentEl.createDiv({ cls: "taskly-webhook-modal-section" });
		eventsSection.createDiv({
			text: "Select events to send:",
			cls: "taskly-webhook-modal-subsection-header",
		});

		const eventsGrid = eventsSection.createDiv({ cls: "taskly-webhook-events-list" });
		const availableEvents: WebhookEvent[] = [
			"task.created",
			"task.updated",
			"task.completed",
			"task.archived",
			"task.deleted",
		];

		availableEvents.forEach((event) => {
			const eventItem = eventsGrid.createDiv({ cls: "taskly-webhook-event-item" });
			const checkbox = eventItem.createEl("input", { type: "checkbox" });

			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selectedEvents.push(event);
				} else {
					this.selectedEvents = this.selectedEvents.filter((e) => e !== event);
				}
			});

			const label = eventItem.createEl("span", { text: event });
			label.addEventListener("click", () => {
				checkbox.checked = !checkbox.checked;
				checkbox.dispatchEvent(new Event("change"));
			});
		});

		// Transform file section
		const transformSection = contentEl.createDiv({ cls: "taskly-webhook-modal-section" });
		transformSection.createDiv({
			text: "Transform File (Optional)",
			cls: "taskly-webhook-modal-subsection-header",
		});

		new Setting(transformSection)
			.setName("Transform file path")
			.setDesc("Path to a .js or .json file in your vault that transforms webhook payloads")
			.addText((text) => {
				text
					.setPlaceholder("e.g., scripts/transform.js")
					.onChange((value) => {
						this.transformFile = value;
					});
			});

		const transformHelp = transformSection.createDiv({ cls: "taskly-webhook-transform-help" });
		const helpHeader = transformHelp.createDiv({ cls: "taskly-webhook-help-header" });
		helpHeader.createSpan({ text: "Transform files allow you to customize webhook payloads:" });
		const helpList = transformHelp.createEl("ul", { cls: "taskly-webhook-help-list" });
		helpList.createEl("li", { text: "Modify the data before it is sent" });
		helpList.createEl("li", { text: "Filter out certain fields" });
		helpList.createEl("li", { text: "Add custom metadata" });

		const helpExample = transformHelp.createDiv({ cls: "taskly-webhook-help-example" });
		helpExample.createEl("div", { text: "Example transform file:", cls: "taskly-webhook-help-title" });
		helpExample.createEl("code", {
			text: "module.exports = (payload) => ({ ...payload, custom: true })",
		});

		// CORS headers toggle section
		const corsSection = contentEl.createDiv({ cls: "taskly-webhook-modal-section" });
		corsSection.createDiv({
			text: "CORS Headers",
			cls: "taskly-webhook-modal-subsection-header",
		});

		new Setting(corsSection)
			.setName("Enable CORS headers")
			.setDesc("Include CORS headers in webhook requests")
			.addToggle((toggle) => {
				toggle.setValue(this.corsHeaders).onChange((value) => {
					this.corsHeaders = value;
				});
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "taskly-webhook-modal-buttons" });
		const cancelBtn = buttonContainer.createEl("button", {
			text: "Cancel",
			cls: "taskly-webhook-modal-btn cancel",
			attr: { "aria-label": "Cancel webhook creation" },
		});
		const cancelIcon = cancelBtn.createSpan({ cls: "taskly-webhook-modal-btn-icon" });
		setIcon(cancelIcon, "x");

		const saveBtn = buttonContainer.createEl("button", {
			text: "Add Webhook",
			cls: "taskly-webhook-modal-btn save mod-cta",
			attr: { "aria-label": "Create webhook" },
		});
		const saveIcon = saveBtn.createSpan({ cls: "taskly-webhook-modal-btn-icon" });
		setIcon(saveIcon, "check");

		cancelBtn.addEventListener("click", () => this.close());
		saveBtn.addEventListener("click", () => {
			if (!this.webhookUrl?.trim()) {
				new Notice("Webhook URL is required");
				return;
			}

			this.onSubmit({
				url: this.webhookUrl,
				events: this.selectedEvents,
				transformFile: this.transformFile.trim() || undefined,
				corsHeaders: this.corsHeaders,
			});
			this.close();
		});
	}

	private webhookUrl: string = "";
}
