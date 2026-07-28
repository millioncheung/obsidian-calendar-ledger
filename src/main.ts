import { Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from './types';
import type { CalendarLedgerSettings } from './types';
import { CalendarLedgerSettingTab } from './settings';
import { registerCommands } from './commands';
import { CalendarLedgerOutlineView, OUTLINE_VIEW_TYPE } from './outline-view';

const REFRESH_DEBOUNCE_MS = 250;

export default class CalendarLedgerPlugin extends Plugin {
	settings!: CalendarLedgerSettings;
	private refreshTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// 注册命令
		registerCommands(this, this.settings, () => this.settings);

		// 注册自定义 Outline View
		this.registerView(
			OUTLINE_VIEW_TYPE,
			(leaf) => new CalendarLedgerOutlineView(leaf, this, this.settings),
		);

		// 添加打开 Outline 的命令
		this.addCommand({
			id: 'open-calendar-outline',
			name: '打开日历大纲',
			callback: () => this.activateOutlineView(),
		});

		// 添加 Ribbon 图标
		this.addRibbonIcon('calendar-days', this.manifest.name, () => {
			void this.activateOutlineView();
		});

		// 注册设置页
		this.addSettingTab(new CalendarLedgerSettingTab(this.app, this));

		// 监听 Calendar.md 修改，debounce 后统一刷新 sidebar tab
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!(file instanceof TFile)) return;
				if (file.path !== this.settings.calendarFilePath) return;
				if (this.refreshTimer !== null) {
					window.clearTimeout(this.refreshTimer);
				}
				this.refreshTimer = window.setTimeout(() => {
					this.refreshTimer = null;
					for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE)) {
						if (leaf.view instanceof CalendarLedgerOutlineView) leaf.view.refreshData();
					}
				}, REFRESH_DEBOUNCE_MS);
			}),
		);
	}

	onunload(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<CalendarLedgerSettings> | null;
		this.settings = normalizeSettings(saved);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE)) {
			if (leaf.view instanceof CalendarLedgerOutlineView) leaf.view.refresh(this.settings);
		}
	}

	/**
	 * 激活自定义 Outline View
	 */
	async activateOutlineView(): Promise<void> {
		const { workspace } = this.app;

		// 检查是否已存在
		const existing = workspace.getLeavesOfType(OUTLINE_VIEW_TYPE);
		if (existing.length > 0 && existing[0]) {
			await workspace.revealLeaf(existing[0]);
			return;
		}

		// 在右侧边栏创建
		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: OUTLINE_VIEW_TYPE, active: true });
			await workspace.revealLeaf(leaf);
		}
	}
}

function normalizeSettings(saved: Partial<CalendarLedgerSettings> | null): CalendarLedgerSettings {
	const data = saved ?? {};
	const currentYear = new Date().getFullYear();
	const startYear = Number.isInteger(data.startYear) && data.startYear! >= 1000 && data.startYear! <= 9999
		? data.startYear!
		: DEFAULT_SETTINGS.startYear;
	const requestedEndYear = Number.isInteger(data.endYear) && data.endYear! >= 1000 && data.endYear! <= 9999
		? data.endYear!
		: DEFAULT_SETTINGS.endYear;

	return {
		calendarFilePath: typeof data.calendarFilePath === 'string' && data.calendarFilePath.trim()
			? data.calendarFilePath.trim()
			: DEFAULT_SETTINGS.calendarFilePath,
		startYear,
		endYear: Math.max(startYear, requestedEndYear || currentYear),
		weekStartsOn: data.weekStartsOn === 'sunday' ? 'sunday' : 'monday',
		language: data.language === 'zh' ? 'zh' : 'en',
		showWeekNumber: typeof data.showWeekNumber === 'boolean'
			? data.showWeekNumber
			: DEFAULT_SETTINGS.showWeekNumber,
		enabledStatsTags: Array.isArray(data.enabledStatsTags)
			? data.enabledStatsTags.filter((tag): tag is string => typeof tag === 'string')
			: [...DEFAULT_SETTINGS.enabledStatsTags],
		visualizationTagMappings: data.visualizationTagMappings
			? { ...data.visualizationTagMappings }
			: { ...DEFAULT_SETTINGS.visualizationTagMappings },
		yearSummaryCards: {
			showRecordedDays: data.yearSummaryCards?.showRecordedDays
				?? DEFAULT_SETTINGS.yearSummaryCards.showRecordedDays,
			tags: {
				...DEFAULT_SETTINGS.yearSummaryCards.tags,
				...(data.yearSummaryCards?.tags ?? {}),
			},
		},
		sidebarUiState: {
			collapsibleSections: {
				...DEFAULT_SETTINGS.sidebarUiState.collapsibleSections,
				...(data.sidebarUiState?.collapsibleSections ?? {}),
			},
		},
	};
}
