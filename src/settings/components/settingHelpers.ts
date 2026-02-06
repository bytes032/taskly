import { Setting, SettingGroup, requireApiVersion } from "obsidian";

export interface ToggleSettingOptions {
	name: string;
	desc: string;
	getValue: () => boolean;
	setValue: (value: boolean) => void;
}

export interface TextSettingOptions {
	name: string;
	desc: string;
	placeholder?: string;
	getValue: () => string;
	setValue: (value: string) => void;
	ariaLabel?: string;
	debounceMs?: number; // Optional debounce time in milliseconds
}

export interface DropdownSettingOptions {
	name: string;
	desc: string;
	options: { value: string; label: string }[];
	getValue: () => string;
	setValue: (value: string) => void;
	ariaLabel?: string;
}

export interface NumberSettingOptions {
	name: string;
	desc: string;
	placeholder?: string;
	getValue: () => number;
	setValue: (value: number) => void;
	min?: number;
	max?: number;
	ariaLabel?: string;
	debounceMs?: number;
}

export interface SettingGroupOptions {
	heading: string;
	description?: string;
	className?: string;
}

/**
 * Check if the current Obsidian version supports SettingGroup (1.11.0+)
 */
function supportsSettingGroup(): boolean {
	return requireApiVersion("1.11.0");
}

/**
 * Legacy fallback that mimics SettingGroup API for Obsidian < 1.11.0
 * Uses the old pattern of section headers and individual settings
 */
class LegacySettingGroup {
	private containerEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.containerEl = containerEl;
	}

	setHeading(text: string | DocumentFragment): this {
		new Setting(this.containerEl).setName(text).setHeading();
		return this;
	}

	addClass(_cls: string): this {
		// No-op for legacy - classes were not applied to groups
		return this;
	}

	addSetting(cb: (setting: Setting) => void): this {
		const setting = new Setting(this.containerEl);
		cb(setting);
		return this;
	}
}

/**
 * Helper for creating a setting group with heading
 * Uses native SettingGroup on Obsidian 1.11.0+, falls back to legacy pattern on older versions
 */
export function createSettingGroup(
	container: HTMLElement,
	options: SettingGroupOptions,
	addSettings: (group: SettingGroup | LegacySettingGroup) => void
): SettingGroup | LegacySettingGroup {
	if (supportsSettingGroup()) {
		// Use native SettingGroup on Obsidian 1.11.0+
		const group = new SettingGroup(container).setHeading(options.heading);

		if (options.className) {
			group.addClass(options.className);
		}

		// Add description as help text if provided
		if (options.description) {
			group.addSetting((setting) => {
				setting.setDesc(options.description!);
				setting.settingEl.addClass("settings-view__group-description");
			});
		}

		addSettings(group);
		return group;
	} else {
		// Fall back to legacy pattern on older Obsidian versions
		const group = new LegacySettingGroup(container).setHeading(options.heading);

		if (options.className) {
			group.addClass(options.className);
		}

		// Add description as help text if provided
		if (options.description) {
			group.addSetting((setting) => {
				setting.setDesc(options.description!);
				setting.settingEl.addClass("settings-view__group-description");
			});
		}

		addSettings(group);
		return group;
	}
}

/**
 * Helper for configuring a toggle setting (works with SettingGroup.addSetting)
 */
export function configureToggleSetting(setting: Setting, options: ToggleSettingOptions): Setting {
	return setting
		.setName(options.name)
		.setDesc(options.desc)
		.addToggle((toggle) => {
			toggle.setValue(options.getValue()).onChange(options.setValue);
		});
}

/**
 * Helper for configuring a text input setting (works with SettingGroup.addSetting)
 */
export function configureTextSetting(setting: Setting, options: TextSettingOptions): Setting {
	return setting
		.setName(options.name)
		.setDesc(options.desc)
		.addText((text) => {
			text.setValue(options.getValue());

			// Use debounced onChange if debounceMs is specified
			if (options.debounceMs && options.debounceMs > 0) {
				const debouncedSetValue = debounce(options.setValue, options.debounceMs);
				text.onChange(debouncedSetValue);
			} else {
				text.onChange(options.setValue);
			}

			if (options.placeholder) {
				text.setPlaceholder(options.placeholder);
			}

			if (options.ariaLabel) {
				text.inputEl.setAttribute("aria-label", options.ariaLabel);
			}

			// Apply consistent styling
			text.inputEl.addClass("settings-view__input");

			return text;
		});
}

/**
 * Helper for configuring a dropdown setting (works with SettingGroup.addSetting)
 */
export function configureDropdownSetting(setting: Setting, options: DropdownSettingOptions): Setting {
	return setting
		.setName(options.name)
		.setDesc(options.desc)
		.addDropdown((dropdown) => {
			options.options.forEach((option) => {
				dropdown.addOption(option.value, option.label);
			});

			dropdown.setValue(options.getValue()).onChange(options.setValue);

			if (options.ariaLabel) {
				dropdown.selectEl.setAttribute("aria-label", options.ariaLabel);
			}

			return dropdown;
		});
}

/**
 * Helper for configuring a number input setting (works with SettingGroup.addSetting)
 */
export function configureNumberSetting(setting: Setting, options: NumberSettingOptions): Setting {
	const setValue = options.debounceMs
		? debounce(options.setValue, options.debounceMs)
		: options.setValue;

	return setting
		.setName(options.name)
		.setDesc(options.desc)
		.addText((text) => {
			text.setValue(options.getValue().toString()).onChange((value) => {
				const num = parseInt(value);
				if (!isNaN(num)) {
					if (options.min !== undefined && num < options.min) return;
					if (options.max !== undefined && num > options.max) return;
					setValue(num);
				}
			});

			text.inputEl.type = "number";

			if (options.placeholder) {
				text.setPlaceholder(options.placeholder);
			}

			if (options.min !== undefined) {
				text.inputEl.setAttribute("min", options.min.toString());
			}

			if (options.max !== undefined) {
				text.inputEl.setAttribute("max", options.max.toString());
			}

			if (options.ariaLabel) {
				text.inputEl.setAttribute("aria-label", options.ariaLabel);
			}

			// Apply consistent styling
			text.inputEl.addClass("settings-view__input");

			return text;
		});
}

/**
 * Helper for creating section headers
 */
export function createSectionHeader(container: HTMLElement, title: string): Setting {
	return new Setting(container).setName(title).setHeading();
}

/**
 * Helper for creating help text with consistent styling
 */
export function createHelpText(container: HTMLElement, text: string): HTMLElement {
	return container.createEl("p", {
		text,
		cls: "settings-view__help-note",
	});
}

/**
 * Debounced function interface with flush capability
 */
export interface DebouncedFunction<T extends (...args: any[]) => any> {
	(...args: Parameters<T>): void;
	/** Immediately execute any pending debounced call */
	flush: () => void;
}

/**
 * Debounce function for reducing save calls
 * Returns a debounced function with a flush() method to immediately execute pending calls
 */
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number,
	immediate = false
): DebouncedFunction<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let lastArgs: Parameters<T> | undefined;
	let lastThis: any;

	const debounced = function (this: any, ...args: Parameters<T>) {
		lastArgs = args;
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		lastThis = this;

		const later = () => {
			timeout = undefined;
			lastArgs = undefined;
			if (!immediate) func.apply(lastThis, args);
		};

		const callNow = immediate && !timeout;
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);

		if (callNow) func.apply(this, args);
	} as DebouncedFunction<T>;

	debounced.flush = () => {
		if (timeout && lastArgs) {
			clearTimeout(timeout);
			timeout = undefined;
			func.apply(lastThis, lastArgs);
			lastArgs = undefined;
		}
	};

	return debounced;
}
