import { App, Modal, Setting } from 'obsidian';

export function confirmAction(
	app: App,
	title: string,
	message: string,
	confirmText: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new ConfirmActionModal(app, title, message, confirmText, resolve);
		modal.open();
	});
}

class ConfirmActionModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private titleText: string,
		private message: string,
		private confirmText: string,
		private resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.titleText });
		contentEl.createEl('p', { text: this.message });

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText('取消')
					.onClick(() => {
						this.finish(false);
					}),
			)
			.addButton((button) =>
				button
					.setButtonText(this.confirmText)
					.setWarning()
					.onClick(() => {
						this.finish(true);
					}),
			);
	}

	onClose(): void {
		this.finish(false);
	}

	private finish(confirmed: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolve(confirmed);
		this.close();
	}
}
