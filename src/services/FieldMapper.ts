/* eslint-disable no-console */
import { FieldMapping, TaskInfo } from "../types";
import { validateCompleteInstances } from "../utils/dateUtils";

/**
 * Service for mapping between internal field names and user-configured property names
 */
export class FieldMapper {
	constructor(private mapping: FieldMapping) {}

	/**
	 * Convert internal field name to user's property name
	 */
	toUserField(internalName: keyof FieldMapping): string {
		return this.mapping[internalName];
	}
	/**
	 * Normalize arbitrary title-like values to a string.
	 * - string: return as-is
	 * - number/boolean: String(value)
	 * - array: join elements stringified with ', '
	 * - object: return empty string (unsupported edge case)
	 */
	private normalizeTitle(val: unknown): string | undefined {
		if (typeof val === "string") return val;
		if (Array.isArray(val)) return val.map((v) => String(v)).join(", ");
		if (val === null || val === undefined) return undefined;
		if (typeof val === "object") return "";
		return String(val);
	}

	/**
	 * Convert frontmatter object using mapping to internal task data
	 */
	mapFromFrontmatter(
		frontmatter: any,
		filePath: string,
		storeTitleInFilename?: boolean
	): Partial<TaskInfo> {
		if (!frontmatter) return {};

		const mapped: Partial<TaskInfo> = {
			path: filePath,
		};

		// Map each field if it exists in frontmatter
		if (frontmatter[this.mapping.title] !== undefined) {
			const rawTitle = frontmatter[this.mapping.title];
			const normalized = this.normalizeTitle(rawTitle);
			if (normalized !== undefined) {
				mapped.title = normalized;
			}
		} else if (storeTitleInFilename) {
			const filename = filePath.split("/").pop()?.replace(".md", "");
			if (filename) {
				mapped.title = filename;
			}
		}

		// Read boolean completed field
		const statusValue = frontmatter[this.mapping.status];
		if (typeof statusValue === "boolean") {
			mapped.status = statusValue ? "done" : "open";
		}

		if (frontmatter[this.mapping.due] !== undefined) {
			mapped.due = frontmatter[this.mapping.due];
		}

		if (frontmatter[this.mapping.completedDate] !== undefined) {
			mapped.completedDate = frontmatter[this.mapping.completedDate];
		}

		if (frontmatter[this.mapping.recurrence] !== undefined) {
			mapped.recurrence = frontmatter[this.mapping.recurrence];
		}

		if (frontmatter[this.mapping.recurrenceAnchor] !== undefined) {
			const anchorValue = frontmatter[this.mapping.recurrenceAnchor];
			// Validate value
			if (anchorValue === 'due' || anchorValue === 'completion') {
				mapped.recurrence_anchor = anchorValue;
			} else if (anchorValue === 'scheduled') {
				mapped.recurrence_anchor = 'due';
			} else {
				console.warn(`Invalid recurrence_anchor value: ${anchorValue}, defaulting to 'due'`);
				mapped.recurrence_anchor = 'due';
			}
		}

		if (frontmatter[this.mapping.dateCreated] !== undefined) {
			mapped.dateCreated = frontmatter[this.mapping.dateCreated];
		}

		if (frontmatter[this.mapping.dateModified] !== undefined) {
			mapped.dateModified = frontmatter[this.mapping.dateModified];
		}

		if (frontmatter[this.mapping.completeInstances] !== undefined) {
			// Validate and clean the complete_instances array
			mapped.complete_instances = validateCompleteInstances(
				frontmatter[this.mapping.completeInstances]
			);
		}

		if (frontmatter[this.mapping.skippedInstances] !== undefined) {
			// Validate and clean the skipped_instances array
			mapped.skipped_instances = validateCompleteInstances(
				frontmatter[this.mapping.skippedInstances]
			);
		}

		if (frontmatter[this.mapping.reminders] !== undefined) {
			const reminders = frontmatter[this.mapping.reminders];
			// Ensure reminders is always an array and filter out null/undefined values
			if (Array.isArray(reminders)) {
				const filteredReminders = reminders
					.filter((r) => r != null)
					.map((r) => {
						if (r && typeof r === "object" && "relatedTo" in r) {
							const relatedTo = (r as any).relatedTo;
							if (relatedTo === "scheduled") {
								return { ...r, relatedTo: "due" };
							}
						}
						return r;
					});
				if (filteredReminders.length > 0) {
					mapped.reminders = filteredReminders;
				}
			} else if (reminders != null) {
				const single =
					reminders &&
					typeof reminders === "object" &&
					"relatedTo" in reminders &&
					(reminders as any).relatedTo === "scheduled"
						? { ...reminders, relatedTo: "due" }
						: reminders;
				mapped.reminders = [single];
			}
		}

		// Handle tags array or string (includes archive tag)
		if (frontmatter.tags) {
			let tags: string[] = [];
			if (Array.isArray(frontmatter.tags)) {
				tags = frontmatter.tags.filter((tag: any) => typeof tag === "string");
			} else if (typeof frontmatter.tags === "string") {
				tags = frontmatter.tags
					.split(",")
					.map((tag: string) => tag.trim())
					.filter((tag: string) => tag.length > 0)
					.map((tag: string) => (tag.startsWith("#") ? tag.slice(1) : tag));
			}

			if (tags.length > 0) {
				mapped.tags = tags;
				mapped.archived = tags.includes(this.mapping.archiveTag);
			}
		}

		return mapped;
	}

	/**
	 * Convert internal task data to frontmatter using mapping
	 */
	mapToFrontmatter(
		taskData: Partial<TaskInfo>,
		taskTag?: string,
		storeTitleInFilename?: boolean
	): any {
		const frontmatter: any = {};

		// Map each field if it exists in task data
		if (taskData.title !== undefined) {
			frontmatter[this.mapping.title] = taskData.title;
		}

		if (storeTitleInFilename) {
			delete frontmatter[this.mapping.title];
		}

		if (taskData.status !== undefined) {
			// Write as boolean: "done" → true, anything else → false
			frontmatter[this.mapping.status] = taskData.status === "done";
		}

		if (taskData.due !== undefined) {
			frontmatter[this.mapping.due] = taskData.due;
		}

		if (taskData.completedDate !== undefined) {
			frontmatter[this.mapping.completedDate] = taskData.completedDate;
		}

		if (taskData.recurrence !== undefined) {
			frontmatter[this.mapping.recurrence] = taskData.recurrence;
		}

		if (taskData.recurrence_anchor !== undefined) {
			frontmatter[this.mapping.recurrenceAnchor] = taskData.recurrence_anchor;
		}

		if (taskData.dateCreated !== undefined) {
			frontmatter[this.mapping.dateCreated] = taskData.dateCreated;
		}

		if (taskData.dateModified !== undefined) {
			frontmatter[this.mapping.dateModified] = taskData.dateModified;
		}

		if (taskData.complete_instances !== undefined) {
			frontmatter[this.mapping.completeInstances] = taskData.complete_instances;
		}

		if (taskData.skipped_instances !== undefined && taskData.skipped_instances.length > 0) {
			frontmatter[this.mapping.skippedInstances] = taskData.skipped_instances;
		}

		if (taskData.reminders !== undefined && taskData.reminders.length > 0) {
			frontmatter[this.mapping.reminders] = taskData.reminders;
		}

		// Handle tags (merge archive status into tags array)
		let tags = taskData.tags ? [...taskData.tags] : [];

		// Ensure task tag is always preserved if provided
		if (taskTag && !tags.includes(taskTag)) {
			tags.push(taskTag);
		}

		if (taskData.archived === true && !tags.includes(this.mapping.archiveTag)) {
			tags.push(this.mapping.archiveTag);
		} else if (taskData.archived === false) {
			tags = tags.filter((tag) => tag !== this.mapping.archiveTag);
		}

		if (tags.length > 0) {
			frontmatter.tags = tags;
		}

		return frontmatter;
	}

	/**
	 * Update mapping configuration
	 */
	updateMapping(newMapping: FieldMapping): void {
		this.mapping = newMapping;
	}

	/**
	 * Get current mapping
	 */
	getMapping(): FieldMapping {
		return { ...this.mapping };
	}

	/**
	 * Look up the FieldMapping key for a given frontmatter property name.
	 *
	 * IMPORTANT: This returns the MAPPING KEY (e.g., "completeInstances"),
	 * NOT the frontmatter property name (e.g., "complete_instances").
	 *
	 * Use this to check if a property is recognized/mapped, but DO NOT use
	 * the returned key directly as a property identifier for TaskCard.
	 *
	 * @param frontmatterPropertyName - The property name from YAML (e.g., "complete_instances")
	 * @returns The FieldMapping key (e.g., "completeInstances") or null if not found
	 *
	 * @example
	 * // Given mapping: { completeInstances: "complete_instances" }
	 * lookupMappingKey("complete_instances") // Returns: "completeInstances"
	 * lookupMappingKey("unknown_field")      // Returns: null
	 */
	lookupMappingKey(frontmatterPropertyName: string): keyof FieldMapping | null {
		for (const [mappingKey, propertyName] of Object.entries(this.mapping)) {
			if (propertyName === frontmatterPropertyName) {
				return mappingKey as keyof FieldMapping;
			}
		}
		return null;
	}

	/**
	 * Check if a frontmatter property name is a recognized/configured field.
	 * Returns true if the property has a mapping, false otherwise.
	 *
	 * @param frontmatterPropertyName - The property name from YAML
	 * @returns true if the property is recognized, false otherwise
	 */
	isRecognizedProperty(frontmatterPropertyName: string): boolean {
		return this.lookupMappingKey(frontmatterPropertyName) !== null;
	}

	/**
	 * Check if a property name matches a specific internal field.
	 * This handles user-configured field names properly.
	 *
	 * @param propertyName - The property name to check (could be user-configured or internal)
	 * @param internalField - The internal field key to check against
	 * @returns true if the propertyName is the user's configured name for this field
	 *
	 * @example
	 * // User has { status: "task-status" }
	 * isPropertyForField("task-status", "status") // true
	 * isPropertyForField("status", "status")      // false
	 *
	 * // User has { status: "status" } (default)
	 * isPropertyForField("status", "status")      // true
	 */
	isPropertyForField(propertyName: string, internalField: keyof FieldMapping): boolean {
		return this.mapping[internalField] === propertyName;
	}

	/**
	 * Convert an array of internal field names to their user-configured property names.
	 *
	 * @param internalFields - Array of FieldMapping keys
	 * @returns Array of user-configured property names
	 *
	 * @example
	 * // User has { status: "task-status", due: "deadline" }
	 * toUserFields(["status", "due"])
	 * // Returns: ["task-status", "deadline"]
	 */
	toUserFields(internalFields: (keyof FieldMapping)[]): string[] {
		return internalFields.map((field) => this.mapping[field]);
	}

	/**
	 * @deprecated Use lookupMappingKey() instead for clarity about what is returned
	 * Convert user's property name back to internal field name
	 * This is the reverse of toUserField()
	 */
	fromUserField(userPropertyName: string): keyof FieldMapping | null {
		return this.lookupMappingKey(userPropertyName);
	}

	/**
	 * Validate that a mapping has no empty field names
	 */
	static validateMapping(mapping: FieldMapping): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		const fields = Object.keys(mapping) as (keyof FieldMapping)[];
		for (const field of fields) {
			if (!mapping[field] || mapping[field].trim() === "") {
				errors.push(`Field "${field}" cannot be empty`);
			}
		}

		// Check for duplicate values
		const values = Object.values(mapping);
		const uniqueValues = new Set(values);
		if (values.length !== uniqueValues.size) {
			errors.push("Field mappings must have unique property names");
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}
}
