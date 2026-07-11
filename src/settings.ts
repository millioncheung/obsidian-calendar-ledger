import { App, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';
import type SingleFileCalendarPlugin from './main';
import { generateCalendarMarkdown } from './calendar-generator';
import { createCalendarFile, restructureCalendar } from './calendar-writer';
import { parseCalendar } from './calendar-parser';
import { scanAllTags } from './stats';
import { classifyTagEventType } from './types';
import type { VisualizationType } from './types';

const SETTINGS_TEXT = {
	en: {
		title: 'Single File Calendar Settings',
		calendarFilePath: 'Calendar file path',
		calendarFilePathDesc: 'Path to the calendar file, for example Calendar.md or folder/Calendar.md',
		startYear: 'Start year',
		startYearDesc: 'First year included in the calendar',
		startYearInvalid: 'Start year must be a four-digit year and cannot be later than end year.',
		endYear: 'End year',
		endYearDesc: 'Last year included in the calendar',
		endYearInvalid: 'End year must be a four-digit year and cannot be earlier than start year.',
		weekStartsOn: 'Week starts on',
		weekStartsOnDesc: 'Used for heatmap and visual layouts. Wxx week numbers in Calendar.md always use ISO weeks, starting on Monday.',
		monday: 'Monday',
		sunday: 'Sunday',
		language: 'Calendar content language',
		languageDesc: 'Language used for weekday names in generated date lines',
		english: 'English',
		chinese: 'Chinese',
		showWeekNumber: 'Show week number',
		showWeekNumberDesc: 'Display week numbers in the calendar. Toggling this updates the existing file structure.',
		weekNumberEnabled: 'Week numbers enabled. Calendar structure updated.',
		weekNumberDisabled: 'Week numbers hidden. Calendar structure updated.',
		statsTags: 'Stats tags',
		statsTagsDesc: 'Choose tags to show in the Stats tab.',
		visualizationMappings: 'Visualization tag mappings',
		visualizationMappingsDesc: 'Map each tag to a Heatmap tab module. Tags are scanned from Calendar.md; tags mapped to None are hidden in the Heatmap tab.',
		generateCalendar: 'Generate calendar file',
		generateCalendarDesc: 'Create the calendar file based on current settings',
		generate: 'Generate',
		calendarGenerated: 'Calendar file generated.',
		loadingTags: 'Scanning tags...',
		vizNone: 'None',
		vizActivity: 'Activity heatmap',
		vizEvent: 'Event timeline',
		vizMonthly: 'Monthly distribution',
		vizRange: 'Date range view',
		displayName: 'Display name:',
		displayNamePlaceholder: 'Display name',
		yearSummary: 'Year Summary',
		summaryCards: 'Summary cards',
		summaryCardsDesc: 'Choose cards to show in the Year tab. Tag cards are generated from Calendar.md and visualization mappings.',
		showRecordedDays: 'Show recorded days',
		noTags: 'No tags found in Calendar.md.',
		showTagCount: (tag: string) => `Show #${tag} count`,
		showTagDays: (tag: string) => `Show #${tag} days`,
		rangeDaysDesc: (name: string) => `Total days for ${name} range events`,
	},
	zh: {
		title: 'Single File Calendar 设置',
		calendarFilePath: '日历文件路径',
		calendarFilePathDesc: '日历文件的路径，例如 Calendar.md 或 folder/Calendar.md',
		startYear: '开始年份',
		startYearDesc: '日历中包含的第一个年份',
		startYearInvalid: '开始年份必须是四位年份，并且不能晚于结束年份。',
		endYear: '结束年份',
		endYearDesc: '日历中包含的最后一个年份',
		endYearInvalid: '结束年份必须是四位年份，并且不能早于开始年份。',
		weekStartsOn: '每周开始于',
		weekStartsOnDesc: '用于热力图等可视化布局。Calendar.md 中的 Wxx 周编号始终使用 ISO 周（星期一开始）。',
		monday: '星期一',
		sunday: '星期日',
		language: '日历内容语言',
		languageDesc: '用于生成日期行中星期名称的语言',
		english: '英文',
		chinese: '中文',
		showWeekNumber: '显示周数',
		showWeekNumberDesc: '在日历中显示周数。切换后会自动更新已有文件结构。',
		weekNumberEnabled: '已显示周数，日历结构已更新。',
		weekNumberDisabled: '已隐藏周数，日历结构已更新。',
		statsTags: '统计标签',
		statsTagsDesc: '选择要在统计标签页中显示的标签。',
		visualizationMappings: '可视化标签映射',
		visualizationMappingsDesc: '将每个标签映射到热力图标签页中的模块。标签会从 Calendar.md 中扫描；映射为“无”的标签不会显示在热力图标签页中。',
		generateCalendar: '生成日历文件',
		generateCalendarDesc: '根据当前设置创建日历文件',
		generate: '生成',
		calendarGenerated: '日历文件已生成。',
		loadingTags: '正在扫描标签...',
		vizNone: '无',
		vizActivity: '活动热力图',
		vizEvent: '事件时间线',
		vizMonthly: '月度分布',
		vizRange: '日期范围视图',
		displayName: '显示名称：',
		displayNamePlaceholder: '显示名称',
		yearSummary: '年度摘要',
		summaryCards: '摘要卡片',
		summaryCardsDesc: '选择要在年份标签页中显示的卡片。标签卡片会根据 Calendar.md 和可视化标签映射生成；这些设置只影响年份标签页。',
		showRecordedDays: '显示已记录天数',
		noTags: 'Calendar.md 中没有找到标签。',
		showTagCount: (tag: string) => `显示 #${tag} 次数`,
		showTagDays: (tag: string) => `显示 #${tag} 天数`,
		rangeDaysDesc: (name: string) => `${name} 范围事件的总天数`,
	},
};

export class SingleFileCalendarSettingTab extends PluginSettingTab {
	plugin: SingleFileCalendarPlugin;

	constructor(app: App, plugin: SingleFileCalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const text = this.text();
		containerEl.empty();

		new Setting(containerEl).setName("").setHeading();

		// Calendar file path
		new Setting(containerEl)
			.setName(text.calendarFilePath)
			.setDesc(text.calendarFilePathDesc)
			.addText((input) =>
				input
					.setPlaceholder('Calendar.md')
					.setValue(this.plugin.settings.calendarFilePath)
					.onChange(async (value) => {
						this.plugin.settings.calendarFilePath = value;
						await this.plugin.saveSettings();
					}),
			);

		// Start year
		new Setting(containerEl)
			.setName(text.startYear)
			.setDesc(text.startYearDesc)
			.addText((input) =>
				input
					.setPlaceholder(String(new Date().getFullYear()))
					.setValue(String(this.plugin.settings.startYear))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (this.isValidYearInput(value) && num <= this.plugin.settings.endYear) {
							this.plugin.settings.startYear = num;
							await this.plugin.saveSettings();
						} else if (value.length >= 4) {
							new Notice(text.startYearInvalid);
						}
					}),
			);

		// End year
		new Setting(containerEl)
			.setName(text.endYear)
			.setDesc(text.endYearDesc)
			.addText((input) =>
				input
					.setPlaceholder(String(new Date().getFullYear() + 2))
					.setValue(String(this.plugin.settings.endYear))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (this.isValidYearInput(value) && num >= this.plugin.settings.startYear) {
							this.plugin.settings.endYear = num;
							await this.plugin.saveSettings();
						} else if (value.length >= 4) {
							new Notice(text.endYearInvalid);
						}
					}),
			);

		// Week starts on
		new Setting(containerEl)
			.setName(text.weekStartsOn)
			.setDesc(text.weekStartsOnDesc)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('monday', text.monday)
					.addOption('sunday', text.sunday)
					.setValue(this.plugin.settings.weekStartsOn)
					.onChange(async (value) => {
						this.plugin.settings.weekStartsOn = value as 'monday' | 'sunday';
						await this.plugin.saveSettings();
					}),
			);

		// Language
		new Setting(containerEl)
			.setName(text.language)
			.setDesc(text.languageDesc)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('en', text.english)
					.addOption('zh', text.chinese)
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value as 'en' | 'zh';
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		// Show week number
		new Setting(containerEl)
			.setName(text.showWeekNumber)
			.setDesc(text.showWeekNumberDesc)
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
								? text.weekNumberEnabled
								: text.weekNumberDisabled);
						}
					}),
			);

		// Stats tags — dynamic checkbox list
		new Setting(containerEl)
			.setName(text.statsTags)
			.setDesc(text.statsTagsDesc);

		const tagsContainer = containerEl.createDiv({ cls: 'sfc-stats-tags-list' });
		void this.populateStatsTagsCheckboxes(tagsContainer);

		// ── Visualization tag mappings ──
		new Setting(containerEl).setName("").setHeading();
		new Setting(containerEl)
			.setName(text.visualizationMappings)
			.setDesc(text.visualizationMappingsDesc);

		const visTagsContainer = containerEl.createDiv({ cls: 'sfc-vis-tags-container' });
		void this.populateVisualizationTagMappings(visTagsContainer);

		// ── Year Summary ──
		void this.renderYearSummarySettings(containerEl);

		// Generate Calendar File button
		containerEl.createEl('hr');
		new Setting(containerEl)
			.setName(text.generateCalendar)
			.setDesc(text.generateCalendarDesc)
			.addButton((button) =>
				button
					.setButtonText(text.generate)
					.setCta()
					.onClick(async () => {
						const content = generateCalendarMarkdown(this.plugin.settings);
						const success = await createCalendarFile(
							this.plugin.app.vault,
							this.plugin.settings.calendarFilePath,
							content,
						);
						if (success) {
							new Notice(text.calendarGenerated);
						}
					}),
			);
	}

	private text(): typeof SETTINGS_TEXT.en {
		return SETTINGS_TEXT[this.plugin.settings.language] ?? SETTINGS_TEXT.en;
	}

	private isValidYearInput(value: string): boolean {
		return /^\d{4}$/.test(value);
	}

	/**
	 * 扫描 Calendar.md 中的所有标签，返回排序后的 tag 列表。
	 * extraDefaults 中的标签会追加到末尾（即使 Calendar.md 中不存在）。
	 */
	private async scanTagsFromCalendar(extraDefaults: string[] = []): Promise<string[]> {
		let tags: string[] = [];
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(
				this.plugin.settings.calendarFilePath,
			);
			if (file instanceof TFile) {
				const content = await this.plugin.app.vault.read(file);
				const parseResult = parseCalendar(content);
				const tagMap = scanAllTags(parseResult.dayBlocks);
				tags = Array.from(tagMap.keys());
			}
		} catch {
			// 文件不存在或读取失败,仅显示默认标签
		}

		for (const t of extraDefaults) {
			if (!tags.includes(t)) tags.push(t);
		}
		tags.sort((a, b) => a.localeCompare(b));
		return tags;
	}

	/**
	 * 扫描 Calendar.md 中的所有标签,渲染为 checkbox list。
	 * 仅显示 Calendar.md 中实际存在的 tag,勾选状态由 enabledStatsTags 决定。
	 */
	private async populateStatsTagsCheckboxes(container: HTMLElement): Promise<void> {
		const text = this.text();
		container.empty();
		container.createSpan({ text: text.loadingTags, cls: 'sfc-stats-tags-loading' });

		const tags = await this.scanTagsFromCalendar([]);
		const enabled = new Set(this.plugin.settings.enabledStatsTags);

		container.empty();
		for (const tag of tags) {
			const item = container.createDiv({ cls: 'sfc-stats-tag-item' });
			const checkbox = item.createEl('input', { type: 'checkbox' });
			checkbox.checked = enabled.has(tag);
			checkbox.id = `sfc-stats-tag-${tag}`;

			const label = item.createEl('label', { text: `#${tag}` });
			label.setAttribute('for', checkbox.id);

			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					enabled.add(tag);
				} else {
					enabled.delete(tag);
				}
				this.plugin.settings.enabledStatsTags = Array.from(enabled);
				void this.plugin.saveSettings();
			});
		}
	}

	/**
	 * 渲染 Visualization tag mappings 设置区域。
	 * 主列表只显示 Calendar.md 中真实扫描到的 tags。
	 * 每行包含 tag name + visualization type 下拉 + displayName 输入框（None 时置灰）。
	 */
	private async populateVisualizationTagMappings(container: HTMLElement): Promise<void> {
		const text = this.text();
		container.empty();
		container.createSpan({ text: text.loadingTags, cls: 'sfc-stats-tags-loading' });

		const tags = await this.scanTagsFromCalendar([]);
		const mappings = this.plugin.settings.visualizationTagMappings;

		container.empty();

		const VIZ_OPTIONS: { value: VisualizationType; label: string }[] = [
			{ value: 'none', label: text.vizNone },
			{ value: 'activity', label: text.vizActivity },
			{ value: 'event', label: text.vizEvent },
			{ value: 'monthly', label: text.vizMonthly },
			{ value: 'range', label: text.vizRange },
		];

		for (const tag of tags) {
			const row = container.createDiv({ cls: 'sfc-viz-mapping-row' });

			row.createEl('span', { text: `#${tag}`, cls: 'sfc-viz-mapping-tag' });

			const select = row.createEl('select', { cls: 'sfc-viz-mapping-select dropdown' });
			for (const opt of VIZ_OPTIONS) {
				const optionEl = select.createEl('option', { value: opt.value, text: opt.label });
				if (mappings[tag]?.vizType === opt.value) {
					optionEl.selected = true;
				}
			}
			if (!mappings[tag]) {
				select.value = 'none';
			}

			row.createEl('span', { text: text.displayName, cls: 'sfc-viz-mapping-namelabel' });

			const nameInput = row.createEl('input', { type: 'text' });
			nameInput.placeholder = text.displayNamePlaceholder;
			nameInput.value = mappings[tag]?.displayName ?? tag;
			nameInput.addClass('sfc-viz-mapping-displayname');
			nameInput.disabled = select.value === 'none';

			select.addEventListener('change', () => {
				const vizType = select.value as VisualizationType;
				if (vizType === 'none') {
					delete this.plugin.settings.visualizationTagMappings[tag];
					nameInput.disabled = true;
				} else {
					this.plugin.settings.visualizationTagMappings[tag] = {
						vizType,
						displayName: nameInput.value.trim() || tag,
					};
					nameInput.disabled = false;
					if (!nameInput.value) {
						nameInput.value = tag;
					}
				}
				void this.plugin.saveSettings();
			});

			nameInput.addEventListener('change', () => {
				const displayName = nameInput.value.trim() || tag;
				if (this.plugin.settings.visualizationTagMappings[tag]) {
					this.plugin.settings.visualizationTagMappings[tag].displayName = displayName;
				}
				void this.plugin.saveSettings();
			});
		}
	}

	/**
	 * 渲染 Year Summary 设置区域（event-type 驱动）。
	 *
	 * 依赖链: Calendar.md → scanTags → classifyTagEventType → UI
	 *
	 * UI 规则:
	 *   - 所有 tag: Show #{tag} count
	 *   - 仅 range event: Show #{tag} days
	 *   - 非 range tag: 不显示 days toggle（隐藏，非 disabled）
	 *
	 * yc.tags[tag] 作为持久缓存: tag 从 Calendar.md 消失时仅隐藏 UI，不删除配置。
	 */
	private async renderYearSummarySettings(containerEl: HTMLElement): Promise<void> {
		const text = this.text();
		new Setting(containerEl).setName("").setHeading();

		new Setting(containerEl)
			.setName(text.summaryCards)
			.setDesc(text.summaryCardsDesc);

		const yc = this.plugin.settings.yearSummaryCards;
		if (!yc.tags) yc.tags = {};

		// 固定通用项：Show Recorded Days
		new Setting(containerEl)
			.setName(text.showRecordedDays)
			.addToggle((toggle) => {
				toggle.setValue(yc.showRecordedDays);
				toggle.onChange(async (value) => {
					yc.showRecordedDays = value;
					await this.plugin.saveSettings();
				});
			});

		// 动态项：扫描 Calendar.md 中所有 tag，按 event-type 驱动生成 UI
		const tagsContainer = containerEl.createDiv({ cls: 'sfc-year-settings-tags' });
		tagsContainer.createSpan({ text: text.loadingTags, cls: 'sfc-stats-tags-loading' });

		const scannedTags = await this.scanTagsFromCalendar([]);
		const mappings = this.plugin.settings.visualizationTagMappings;

		tagsContainer.empty();

		if (scannedTags.length === 0) {
			tagsContainer.createDiv({
				text: text.noTags,
				cls: 'sfc-empty',
			});
			return;
		}

		for (const tag of scannedTags) {
			const eventType = classifyTagEventType(tag, mappings);
			const mapping = mappings[tag];
			// 默认 showCount = true; showDays 仅 range 有意义，默认 false
			const tagSettings = yc.tags[tag] ?? { showCount: true, showDays: false };
			if (!yc.tags[tag]) yc.tags[tag] = tagSettings;

			// count: 所有 event type 都支持
			new Setting(tagsContainer)
				.setName(text.showTagCount(tag))
				.addToggle((toggle) => {
					toggle.setValue(tagSettings.showCount);
					toggle.onChange(async (value) => {
						tagSettings.showCount = value;
						await this.plugin.saveSettings();
					});
				});

			// days: 仅 range event 支持，其余类型不渲染该 toggle
			if (eventType === 'range') {
				new Setting(tagsContainer)
					.setName(text.showTagDays(tag))
					.setDesc(text.rangeDaysDesc(mapping!.displayName ?? tag))
					.addToggle((toggle) => {
						toggle.setValue(tagSettings.showDays);
						toggle.onChange(async (value) => {
							tagSettings.showDays = value;
							await this.plugin.saveSettings();
						});
					});
			}
		}
	}
}
