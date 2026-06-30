import { MarkdownView, WorkspaceLeaf, type Plugin } from 'obsidian';

/**
 * 跳转到 Calendar.md 指定行
 *
 * 统一切换到编辑模式，行为：
 *   1. 打开 Calendar.md
 *   2. 用 parser 的 lineStart 定位目标行
 *   3. editor.setCursor 到行末
 *   4. editor.scrollIntoView 居中
 *   5. setTimeout 300ms 后添加高亮 class（等滚动基本完成，不依赖 scroll end）
 *   6. 高亮持续 1500ms 后移除 class
 *
 * 不依赖 scroll animation end 事件。
 * 不在阅读模式 DOM 中查找日期文本。
 * 跳转和高亮都基于 editor lineStart。
 *
 * @param line 0-based 行号（parser 的 lineStart）
 * @param hint 日期标题，domAtPos 失败时兜底匹配用
 */
export async function navigateToCalendarLine(
	plugin: Plugin,
	filePath: string,
	line: number,
	hint?: string,
): Promise<void> {
	const file = plugin.app.vault.getFileByPath(filePath);
	if (!file) return;

	try {
		clearCurrentHighlight();

		// 1. 查找 Calendar.md 是否已在某个 leaf 中打开
		let targetLeaf: WorkspaceLeaf | null = null;
		const leaves = plugin.app.workspace.getLeavesOfType('markdown');
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) {
				targetLeaf = leaf;
				break;
			}
		}

		// 2. 没有则新建 tab 打开（不传 eState 避免触发 Obsidian 原生跳转高亮）
		if (!targetLeaf) {
			targetLeaf = plugin.app.workspace.getLeaf('tab');
			await targetLeaf.openFile(file, { active: true });
		} else {
			plugin.app.workspace.revealLeaf(targetLeaf);
		}

		// 3. 激活 leaf
		plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

		const view = targetLeaf.view;
		if (!(view instanceof MarkdownView)) return;

		// 4. 统一切换到编辑模式
		const state = view.getState();
		if (state.mode !== 'source') {
			state.mode = 'source';
			await view.setState(state, { history: true });
		}

		// 5. 等待 editor 就绪
		const editor = await waitForEditor(view);
		if (!editor) return;

		// 6. 用 lineStart 定位目标行，setCursor 到行末
		const targetLine = Math.min(line, editor.lastLine());
		const lineContent = editor.getLine(targetLine);
		const pos = { line: targetLine, ch: lineContent.length };
		editor.setCursor(pos);
		editor.focus();

		// 7. scrollIntoView 居中
		editor.scrollIntoView({ from: pos, to: pos }, true);

		// 8. 延迟 300ms 后添加高亮 class（等滚动基本完成，不依赖 scroll end 事件）
		currentHighlightTimeout = window.setTimeout(() => {
			currentHighlightTimeout = null;
			const lineEl = findEditorLineEl(view, editor, targetLine, hint);
			if (!lineEl) return;

			lineEl.classList.add('sfc-flash');
			currentHighlightEl = lineEl;

			// 9. 高亮持续 1500ms 后移除 class
			window.setTimeout(() => {
				lineEl.classList.remove('sfc-flash');
				if (currentHighlightEl === lineEl) {
					currentHighlightEl = null;
				}
			}, 1500);
		}, 300);
	} catch (e) {
		console.error('[SFC] navigateToCalendarLine error:', e);
	}
}

// ────────────────────────────────────────────────────────────────
// 目标行定位
// ────────────────────────────────────────────────────────────────

/**
 * 定位目标行的 .cm-line 元素（基于 lineStart，不查阅读模式 DOM）
 *
 * 查找顺序：
 *   1. CM6 domAtPos —— 通过 lineStart 偏移量直接定位（最可靠）
 *   2. hint 文本匹配 —— domAtPos 失败时兜底
 *   3. .cm-activeLine —— 最后兜底
 */
function findEditorLineEl(
	view: MarkdownView,
	editor: MarkdownView['editor'],
	line: number,
	hint?: string,
): HTMLElement | null {
	const cm = (editor as any).cm;

	// 方式 1：CM6 domAtPos（基于 lineStart）
	if (cm?.domAtPos && cm?.state) {
		try {
			const lineObj = cm.state.doc.line(line + 1); // CM6 行号 1-based
			const dom = cm.domAtPos(lineObj.from);
			let node: Node | null = dom.node;
			if (node && node.nodeType === Node.TEXT_NODE) {
				node = node.parentElement;
			}
			if (node) {
				const lineEl = (node as HTMLElement).closest('.cm-line');
				if (lineEl) return lineEl as HTMLElement;
			}
		} catch {
			// ignore
		}
	}

	// 方式 2：hint startsWith 匹配（编辑模式 DOM）
	if (hint) {
		const lines = view.contentEl.querySelectorAll<HTMLElement>('.cm-line');
		for (let i = 0; i < lines.length; i++) {
			const el = lines[i]!;
			const text = (el.textContent || '').trim();
			if (text.startsWith(hint) || hint.startsWith(text)) {
				return el;
			}
		}
	}

	// 方式 3：.cm-activeLine（兜底）
	return view.contentEl.querySelector<HTMLElement>('.cm-activeLine');
}

// ────────────────────────────────────────────────────────────────
// 高亮管理
// ────────────────────────────────────────────────────────────────

let currentHighlightEl: HTMLElement | null = null;
let currentHighlightTimeout: number | null = null;

function clearCurrentHighlight(): void {
	if (currentHighlightTimeout != null) {
		clearTimeout(currentHighlightTimeout);
		currentHighlightTimeout = null;
	}
	if (currentHighlightEl) {
		currentHighlightEl.classList.remove('sfc-flash');
		currentHighlightEl = null;
	}
}

// ────────────────────────────────────────────────────────────────
// 工具函数
// ────────────────────────────────────────────────────────────────

async function waitForEditor(
	view: MarkdownView,
	maxAttempts = 30,
): Promise<MarkdownView['editor'] | null> {
	for (let i = 0; i < maxAttempts; i++) {
		if (view.editor) return view.editor;
		await new Promise((r) => setTimeout(r, 50));
	}
	return null;
}
