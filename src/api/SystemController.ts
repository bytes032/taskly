import { IncomingMessage, ServerResponse } from "http";
import { BaseController } from "./BaseController";
import { NaturalLanguageParser } from "../services/NaturalLanguageParser";
import { TaskCreationData, IWebhookNotifier } from "../types";
import { TaskService } from "../services/TaskService";
import TasklyPlugin from "../main";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Get, Post } from "../utils/OpenAPIDecorators";

export class SystemController extends BaseController {
	constructor(
		private plugin: TasklyPlugin,
		private taskService: TaskService,
		private nlParser: NaturalLanguageParser,
		private webhookNotifier: IWebhookNotifier
	) {
		super();
	}

	@Get("/api/health")
	async healthCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const vaultName = this.plugin.app.vault.getName();
		const adapter = this.plugin.app.vault.adapter as any;

		// Try to get vault path information
		let vaultPath = null;
		try {
			// Check if adapter has basePath property (some adapters expose this)
			if ("basePath" in adapter && typeof adapter.basePath === "string") {
				vaultPath = adapter.basePath;
			} else if ("path" in adapter && typeof adapter.path === "string") {
				vaultPath = adapter.path;
			}
		} catch (error) {
			// Silently fail if vault path isn't accessible
		}

		this.sendResponse(
			res,
			200,
			this.successResponse({
				status: "ok",
				timestamp: new Date().toISOString(),
				vault: {
					name: vaultName,
					path: vaultPath,
				},
			})
		);
	}

	@Post("/api/nlp/parse")
	async handleNLPParse(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const body = await this.parseRequestBody(req);

			if (!body.text || typeof body.text !== "string") {
				this.sendResponse(
					res,
					400,
					this.errorResponse("Text field is required and must be a string")
				);
				return;
			}

			// Parse the natural language input
			const parsedData = this.nlParser.parseInput(body.text);

			// Convert ParsedTaskData to TaskCreationData format
			const taskData: TaskCreationData = {
				title: parsedData.title,
				details: parsedData.details,
				status: parsedData.status || this.getDefaultStatus(),
				tags: parsedData.tags,
				recurrence: parsedData.recurrence,
			};

			// Handle dates
			if (parsedData.dueDate) {
				taskData.due = parsedData.dueDate;
				if (parsedData.dueTime) {
					taskData.due = `${parsedData.dueDate} ${parsedData.dueTime}`;
				}
			}

			this.sendResponse(
				res,
				200,
				this.successResponse({
					parsed: parsedData,
					taskData: taskData,
				})
			);
		} catch (error: any) {
			this.sendResponse(res, 500, this.errorResponse(error.message));
		}
	}

	@Post("/api/nlp/create")
	async handleNLPCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const body = await this.parseRequestBody(req);

			if (!body.text || typeof body.text !== "string") {
				this.sendResponse(
					res,
					400,
					this.errorResponse("Text field is required and must be a string")
				);
				return;
			}

			// Parse the natural language input
			const parsedData = this.nlParser.parseInput(body.text);

			// Convert ParsedTaskData to TaskCreationData format
			const taskData: TaskCreationData = {
				title: parsedData.title,
				details: parsedData.details,
				status: parsedData.status || this.getDefaultStatus(),
				tags: parsedData.tags,
				recurrence: parsedData.recurrence,
				creationContext: "api",
			};

			// Handle dates
			if (parsedData.dueDate) {
				taskData.due = parsedData.dueDate;
				if (parsedData.dueTime) {
					taskData.due = `${parsedData.dueDate} ${parsedData.dueTime}`;
				}
			}

			// Create the task - TaskService.createTask() applies defaults automatically
			const result = await this.taskService.createTask(taskData);

			// Trigger webhook for task creation via NLP
			await this.webhookNotifier.triggerWebhook("task.created", {
				task: result.taskInfo,
				source: "nlp",
				originalText: body.text,
			});

			this.sendResponse(
				res,
				201,
				this.successResponse({
					task: result.taskInfo,
					parsed: parsedData,
				})
			);
		} catch (error: any) {
			this.sendResponse(res, 400, this.errorResponse(error.message));
		}
	}

	private getDefaultStatus(): string {
		// Get the first status (lowest order) as default, same logic as TaskModal
		const statusConfigs = this.plugin.settings.customStatuses;
		if (statusConfigs && statusConfigs.length > 0) {
			const sortedStatuses = [...statusConfigs].sort((a, b) => a.order - b.order);
			return sortedStatuses[0].value;
		}
		return "open"; // fallback
	}

}
