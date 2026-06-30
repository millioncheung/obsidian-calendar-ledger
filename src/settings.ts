import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type SingleFileCalendarPlugin from './main';
import { generateCalendarMarkdown } from './calendar-generator';
import { createCalendarFile, restructureCalendar } from './calendar-writer';

export class SingleFileCalendarSettingTab extends PluginSettingTab {
	plugin: SingleFileCalendarPlugin;

	constructor(app: App, plugin: SingleFileCalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Single File Calendar Settings' });

		// Calendar file path
		new Setting(containerEl)
			.setName('Calendar file path')
			.setDesc('Path to the calendar file (e.g. Calendar.md or folder/Calendar.md)')
			.addText((text) =>
				text
					.setPlaceholder('Calendar.md')
					.setValue(this.plugin.settings.calendarFilePath)
					.onChange(async (value) => {
						this.plugin.settings.calendarFilePath = value;
						await this.plugin.saveSettings();
					}),
			);

		// Start year
		new Setting(containerEl)
			.setName('Start year')
			.setDesc('First year to include in the calendar')
			.addText((text) =>
				text
					.setPlaceholder(String(new Date().getFullYear()))
					.setValue(String(this.plugin.settings.startYear))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.startYear = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		// End year
		new Setting(containerEl)
			.setName('End year')
			.setDesc('Last year to include in the calendar')
			.addText((text) =>
				text
					.setPlaceholder(String(new Date().getFullYear() + 2))
					.setValue(String(this.plugin.settings.endYear))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.endYear = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		// Week starts on
		new Setting(containerEl)
			.setName('Week starts on')
			.setDesc('First day of the week')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('monday', 'Monday')
					.addOption('sunday', 'Sunday')
					.setValue(this.plugin.settings.weekStartsOn)
					.onChange(async (value) => {
						this.plugin.settings.weekStartsOn = value as 'monday' | 'sunday';
						await this.plugin.saveSettings();
					}),
			);

		// Language
		new Setting(containerEl)
			.setName('Language')
			.setDesc('Language for weekday names')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('en', 'English')
					.addOption('zh', 'Chinese')
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value as 'en' | 'zh';
						await this.plugin.saveSettings();
					}),
			);

		// Show week number
		new Setting(containerEl)
			.setName('Show week number')
			.setDesc('Display week numbers in the calendar. Toggling auto-updates the existing file.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showWeekNumber)
					.onChange(async (value) => {
						this.plugin.settings.showWeekNumber = value;
						await this.plugin.saveSettings();
						// 自动重建已有文档结构，保留各日期已记录的内容
						const updated = await restructureCalendar(
							this.plugin.app.vault,
							this.plugin.settings.calendarFilePath,
							this.plugin.settings,
						);
						if (updated) {
							new Notice(value
								? 'Week numbers enabled. Calendar structure updated.'
								: 'Week numbers hidden. Calendar structure updated.');
						}
					}),
			);

		// Default outline level
		new Setting(containerEl)
			.setName('Default outline level')
			.setDesc('Default granularity for the outline view')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('year', 'Year')
					.addOption('month', 'Month')
					.addOption('week', 'Week')
					.addOption('day', 'Day')
					.setValue(this.plugin.settings.defaultOutlineLevel)
					.onChange(async (value) => {
						this.plugin.settings.defaultOutlineLevel = value as 'year' | 'month' | 'week' | 'day';
						await this.plugin.saveSettings();
					}),
			);

		// Generate Calendar File button
		containerEl.createEl('hr');
		new Setting(containerEl)
			.setName('Generate calendar file')
			.setDesc('Create or overwrite the calendar file based on current settings')
			.addButton((button) =>
				button
					.setButtonText('Generate')
					.setCta()
					.onClick(async () => {
						const content = generateCalendarMarkdown(this.plugin.settings);
						const success = await createCalendarFile(
							this.plugin.app.vault,
							this.plugin.settings.calendarFilePath,
							content,
							true,
						);
						if (success) {
							new Notice('Calendar file generated successfully.');
						}
					}),
			);
	}
}