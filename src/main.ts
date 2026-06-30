import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS } from './types';
import type { SingleFileCalendarSettings } from './types';
import { SingleFileCalendarSettingTab } from './settings';
import { registerCommands } from './commands';
import { CalendarOutlineView, OUTLINE_VIEW_TYPE } from './outline-view';

export default class SingleFileCalendarPlugin extends Plugin {
	settings!: SingleFileCalendarSettings;
	private outlineView: CalendarOutlineView | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// 注册命令
		registerCommands(this, this.settings, () => this.settings);

		// 注册自定义 Outline View
		this.registerView(
			OUTLINE_VIEW_TYPE,
			(leaf) => {
				this.outlineView = new CalendarOutlineView(leaf, this, this.settings);
				return this.outlineView;
			},
		);

		// 添加打开 Outline 的命令
		this.addCommand({
			id: 'open-calendar-outline',
			name: 'Open calendar outline',
			callback: () => this.activateOutlineView(),
		});

		// 添加 Ribbon 图标
		this.addRibbonIcon('calendar-days', 'Single File Calendar', () => {
			this.activateOutlineView();
		});

		// 注册设置页
		this.addSettingTab(new SingleFileCalendarSettingTab(this.app, this));
	}

	onunload(): void {
		this.outlineView = null;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SingleFileCalendarSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// 刷新 outline view
		if (this.outlineView) {
			this.outlineView.refresh(this.settings);
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
			workspace.revealLeaf(existing[0]);
			return;
		}

		// 在右侧边栏创建
		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: OUTLINE_VIEW_TYPE, active: true });
			workspace.revealLeaf(leaf);
		}
	}
}