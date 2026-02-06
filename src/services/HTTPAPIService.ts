/* eslint-disable no-console */
import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { parse } from "url";
import { IWebhookNotifier } from "../types";
import { TaskService } from "./TaskService";
import { FilterService } from "./FilterService";
import { TaskManager } from "../utils/TaskManager";
import { NaturalLanguageParser } from "./NaturalLanguageParser";
import { StatusManager } from "./StatusManager";
import TasklyPlugin from "../main";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { APIRouter } from "../api/APIRouter";
import { TasksController } from "../api/TasksController";
import { SystemController } from "../api/SystemController";
import { WebhookController } from "../api/WebhookController";

export class HTTPAPIService implements IWebhookNotifier {
	private server?: Server;
	private plugin: TasklyPlugin;
	private router: APIRouter;
	private tasksController: TasksController;
	private systemController: SystemController;
	private webhookController: WebhookController;

	constructor(
		plugin: TasklyPlugin,
		taskService: TaskService,
		filterService: FilterService,
		cacheManager: TaskManager
	) {
		this.plugin = plugin;

		// Initialize dependencies
		const nlParser = NaturalLanguageParser.fromPlugin(plugin);
		const statusManager = new StatusManager(plugin.settings.customStatuses);

		// Initialize controllers
		this.webhookController = new WebhookController(plugin);
		this.tasksController = new TasksController(
			plugin,
			taskService,
			filterService,
			cacheManager,
			statusManager,
			this.webhookController
		);
		this.systemController = new SystemController(
			plugin,
			taskService,
			nlParser,
			this.webhookController
		);

		// Initialize router and register routes
		this.router = new APIRouter();
		this.setupRoutes();
	}

	private setupRoutes(): void {
		// Register all controllers using decorators
		this.router.registerController(this.tasksController);
		this.router.registerController(this.systemController);
		this.router.registerController(this.webhookController);
	}

	private async handleCORSPreflight(req: IncomingMessage, res: ServerResponse): Promise<void> {
		res.statusCode = 200;
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
		res.end();
	}

	private authenticate(req: IncomingMessage): boolean {
		const authToken = this.plugin.settings.apiAuthToken;

		// Skip auth if no token is configured
		if (!authToken) {
			return true;
		}

		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return false;
		}

		const token = authHeader.substring(7);
		return token === authToken;
	}

	private sendResponse(res: ServerResponse, statusCode: number, data: any): void {
		res.statusCode = statusCode;
		res.setHeader("Content-Type", "application/json");
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
		res.end(JSON.stringify(data));
	}

	private successResponse<T>(
		data: T,
		message?: string
	): { success: boolean; data: T; message?: string } {
		return { success: true, data, message };
	}

	private errorResponse(error: string): { success: boolean; error: string } {
		return { success: false, error };
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			// Handle CORS preflight requests
			if (req.method === "OPTIONS") {
				await this.handleCORSPreflight(req, res);
				return;
			}

			// Parse URL for authentication check
			const parsedUrl = parse(req.url || "", true);
			const pathname = parsedUrl.pathname || "";

			// Check authentication for API routes
			if (pathname.startsWith("/api/") && !this.authenticate(req)) {
				this.sendResponse(res, 401, this.errorResponse("Authentication required"));
				return;
			}

			// Try to route the request
			const handled = await this.router.route(req, res);

			// If no route was found, return 404
			if (!handled) {
				this.sendResponse(res, 404, this.errorResponse("Not found"));
			}
		} catch (error: any) {
			console.error("API Error:", error);
			this.sendResponse(res, 500, this.errorResponse("Internal server error"));
		}
	}

	// Webhook interface implementation - delegate to WebhookController
	async triggerWebhook(event: any, data: any): Promise<void> {
		await this.webhookController.triggerWebhook(event, data);
	}

	async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.server = createServer((req, res) => {
					this.handleRequest(req, res).catch((error) => {
						console.error("Request handling error:", error);
						this.sendResponse(res, 500, this.errorResponse("Internal server error"));
					});
				});

				this.server.listen(this.plugin.settings.apiPort, () => {
					console.log(
						`Taskly API server started on port ${this.plugin.settings.apiPort}`
					);
					resolve();
				});

				this.server.on("error", (err) => {
					console.error("API server error:", err);
					reject(err);
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	async stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => {
					console.log("Taskly API server stopped");
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	isRunning(): boolean {
		return !!this.server && this.server.listening;
	}

	getPort(): number {
		return this.plugin.settings.apiPort;
	}
}
