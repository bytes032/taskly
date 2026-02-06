import TasklyPlugin from "../../main";
import { Reminder } from "../../types";
import { splitFrontmatterAndBody } from "../../utils/helpers";

export class TaskFormController {
	private plugin: TasklyPlugin;
	// Core task properties
	title = "";
	details = "";
	originalDetails = "";
	dueDate = "";
	status = "open";
	tags = "";
	recurrenceRule = "";
	recurrenceAnchor: "due" | "completion" = "due";
	reminders: Reminder[] = [];

	// User-defined fields (dynamic based on settings)
	userFields: Record<string, any> = {};

	constructor(plugin: TasklyPlugin) {
		this.plugin = plugin;
	}

	extractDetailsFromContent(content: string): string {
		const { body } = splitFrontmatterAndBody(content);
		return body.replace(/\r\n/g, "\n").trimEnd();
	}

	normalizeDetails(value: string): string {
		return value.replace(/\r\n/g, "\n").trimEnd();
	}

	validateForm(): boolean {
		return this.title.trim().length > 0;
	}

	getDefaultStatus(): string {
		// Get the first status (lowest order) as default
		const statusConfigs = this.plugin.settings.customStatuses;
		if (statusConfigs && statusConfigs.length > 0) {
			const sortedStatuses = [...statusConfigs].sort((a, b) => a.order - b.order);
			return sortedStatuses[0].value;
		}
		return "open"; // fallback
	}

	getRecurrenceDisplayText(ruleOverride?: string): string {
		const rule = ruleOverride ?? this.recurrenceRule;
		if (!rule) return "";

		if (rule.includes("FREQ=DAILY")) {
			return "Daily";
		} else if (rule.includes("FREQ=WEEKLY")) {
			if (rule.includes("INTERVAL=2")) {
				return "Every 2 weeks";
			} else if (rule.includes("BYDAY=MO,TU,WE,TH,FR")) {
				return "Weekdays";
			} else if (rule.includes("BYDAY=")) {
				const dayMatch = rule.match(/BYDAY=([A-Z]{2})/);
				if (dayMatch) {
					const dayMap: Record<string, string> = {
						SU: "Sunday",
						MO: "Monday",
						TU: "Tuesday",
						WE: "Wednesday",
						TH: "Thursday",
						FR: "Friday",
						SA: "Saturday",
					};
					return `Weekly on ${dayMap[dayMatch[1]] || dayMatch[1]}`;
				}
				return "Weekly";
			} else {
				return "Weekly";
			}
		} else if (rule.includes("FREQ=MONTHLY")) {
			if (rule.includes("INTERVAL=3")) {
				return "Every 3 months";
			} else if (rule.includes("BYMONTHDAY=")) {
				const dayMatch = rule.match(/BYMONTHDAY=(\d+)/);
				if (dayMatch) {
					return `Monthly on the ${this.getOrdinal(parseInt(dayMatch[1]))}`;
				}
				return "Monthly";
			} else if (rule.includes("BYDAY=")) {
				return "Monthly (by weekday)";
			} else {
				return "Monthly";
			}
		} else if (rule.includes("FREQ=YEARLY")) {
			if (rule.includes("BYMONTH=") && rule.includes("BYMONTHDAY=")) {
				const monthMatch = rule.match(/BYMONTH=(\d+)/);
				const dayMatch = rule.match(/BYMONTHDAY=(\d+)/);
				if (monthMatch && dayMatch) {
					const monthNames = [
						"",
						"January",
						"February",
						"March",
						"April",
						"May",
						"June",
						"July",
						"August",
						"September",
						"October",
						"November",
						"December",
					];
					const month = monthNames[parseInt(monthMatch[1])];
					const day = this.getOrdinal(parseInt(dayMatch[1]));
					return `Yearly on ${month} ${day}`;
				}
			}
			return "Yearly";
		}

		let endText = "";
		if (rule.includes("COUNT=")) {
			const countMatch = rule.match(/COUNT=(\d+)/);
			if (countMatch) {
				endText = ` (${countMatch[1]} times)`;
			}
		} else if (rule.includes("UNTIL=")) {
			const untilMatch = rule.match(/UNTIL=(\d{8})/);
			if (untilMatch) {
				const date = untilMatch[1];
				const formatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
				endText = ` (until ${formatted})`;
			}
		}

		return "Custom" + endText;
	}

	private getOrdinal(n: number): string {
		const s = ["th", "st", "nd", "rd"];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	}
}
