import { MarkdownView, WorkspaceLeaf, type Plugin } from 'obsidian';

interface CodeMirrorLineLike {
	from: number;
}

interface CodeMirrorLike {
	state: { doc: { line: (line: number) => CodeMirrorLineLike } };
	coordsAtPos: (position: number) => { top: number; bottom: number } | null;
	domAtPos: (position: number) => { node: Node };
}

function getCodeMirror(editor: MarkdownView['editor']): CodeMirrorLike | null {
	return (editor as unknown as { cm?: CodeMirrorLike }).cm ?? null;
}

/**
 * 跳转到 Calendar.md 指定行
 *
 * 统一切换到编辑模式，行为：
 *   - 光标置于行末（基于 lineStart）
 *   - 600ms easeOutQuart 滚动动画（类似 Spring 减速感）
 *   - 滚动开始 500ms 后添加高亮 class（不依赖 scroll end 事件）
 *   - 高亮持续 1500ms 后移除
 *
 * @param line 0-based 行号（parser 的 lineStart）
 * @param hint 日期标题（如 "06-16 Tue"），用于兜底匹配行元素
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

		// 2. 没有则新建 tab 打开（不传 eState，避免 Obsidian 原生跳转 flash）
		if (!targetLeaf) {
			targetLeaf = plugin.app.workspace.getLeaf('tab');
			await targetLeaf.openFile(file, { active: true });
		} else {
			await plugin.app.workspace.revealLeaf(targetLeaf);
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

		// 6. setCursor 到行末（基于 lineStart）
		const targetLine = Math.min(line, editor.lastLine());
		const lineContent = editor.getLine(targetLine);
		const pos = { line: targetLine, ch: lineContent.length };
		editor.setCursor(pos);
		editor.focus();

		// 7. 等待 CM6 渲染（光标行装饰更新 + coordsAtPos 就绪）
		await new Promise((r) => window.requestAnimationFrame(() => window.requestAnimationFrame(r)));

		const cm = getCodeMirror(editor);
		const scroller = view.contentEl.querySelector<HTMLElement>('.cm-scroller');

		// 8. 计算目标 scrollTop 并滚动（600ms 动画，不 await，与高亮并行）
		const targetTop = cm && scroller ? computeTargetTop(cm, scroller, targetLine) : null;

		if (targetTop != null && scroller) {
			smoothScrollTo(scroller, targetTop, 600);
		} else {
			// fallback：CM6 原生 scrollIntoView（瞬间，无动画，但确保目标行进入视口）
			editor.scrollIntoView({ from: pos, to: pos }, true);
		}

		// 9. 500ms 后高亮（不依赖滚动完成，setTimeout 控制）
		scheduleHighlight(view, editor, targetLine, hint);
	} catch (e) {
		console.error('[SFC] navigateToCalendarLine error:', e);
	}
}

// ────────────────────────────────────────────────────────────────
// 位置计算 + 滚动
// ────────────────────────────────────────────────────────────────

/**
 * 用 CM6 coordsAtPos 计算让目标行居中的 scrollTop
 *
 * coordsAtPos 返回目标行首字符的屏幕坐标。即使目标行在视口外较远
 * 位置未渲染，CM6 也能根据文档结构估算其坐标。
 */
function computeTargetTop(
	cm: CodeMirrorLike,
	scroller: HTMLElement,
	line: number,
): number | null {
	try {
		const lineObj = cm.state.doc.line(line + 1); // CM6 行号 1-based
		const coords = cm.coordsAtPos(lineObj.from);
		if (!coords) return null;

		const scrollerRect = scroller.getBoundingClientRect();
		const lineMidInScroller =
			(coords.top + coords.bottom) / 2 - scrollerRect.top + scroller.scrollTop;
		return lineMidInScroller - scrollerRect.height / 2;
	} catch {
		return null;
	}
}

/**
 * rAF smooth 滚动（easeOutQuart 缓动，类似 Spring 减速感）
 *
 * 不返回 Promise —— 滚动与高亮并行，高亮由 setTimeout 500ms 控制。
 * 用 scrollToken 取消连续点击时的旧动画循环，避免冲突。
 */
function smoothScrollTo(scroller: HTMLElement, targetTop: number, duration: number): void {
	const startTop = scroller.scrollTop;
	const distance = targetTop - startTop;
	if (Math.abs(distance) < 2) return;

	const myToken = ++scrollToken;
	const startTime = performance.now();

	const step = (now: number) => {
		if (myToken !== scrollToken) return; // 被新滚动取消
		const elapsed = now - startTime;
		const t = Math.min(elapsed / duration, 1);
		// easeOutQuart：起步快、末段慢，类似 Spring 收敛
		const eased = 1 - Math.pow(1 - t, 4);
		scroller.scrollTop = startTop + distance * eased;
		if (t < 1) {
			window.requestAnimationFrame(step);
		}
	};
	window.requestAnimationFrame(step);
}

// ────────────────────────────────────────────────────────────────
// 目标行定位
// ────────────────────────────────────────────────────────────────

/**
 * 定位目标行的 .cm-line 元素
 *
 * 查找顺序：
 *   1. CM6 domAtPos —— 通过源码偏移量直接定位
 *   2. hint 文本匹配 —— 用日期标题 startsWith 匹配
 *   3. .cm-activeLine —— 最后兜底
 */
function findEditorLineEl(
	view: MarkdownView,
	editor: MarkdownView['editor'],
	line: number,
	hint?: string,
): HTMLElement | null {
	const cm = getCodeMirror(editor);

	// 方式 1：CM6 domAtPos
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

	// 方式 2：用 hint（日期标题）startsWith 匹配
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
// 高亮（class + CSS animation，setTimeout 控制时机）
// ────────────────────────────────────────────────────────────────

let scrollToken = 0;
let highlightTimer: number | null = null;
let currentHighlightEl: HTMLElement | null = null;

function clearCurrentHighlight(): void {
	if (highlightTimer) {
		window.clearTimeout(highlightTimer);
		highlightTimer = null;
	}
	if (currentHighlightEl) {
		currentHighlightEl.classList.remove('sfc-jump-flash');
		currentHighlightEl = null;
	}
}

/**
 * 500ms 后添加高亮 class，1500ms 后移除
 *
 * 不依赖滚动动画完成，用 setTimeout 控制：
 *   - 500ms 时滚动已基本完成（600ms 动画的 83%），目标行在视口中心
 *   - 此时 domAtPos 定位准确，高亮不会错行
 */
function scheduleHighlight(
	view: MarkdownView,
	editor: MarkdownView['editor'],
	targetLine: number,
	hint?: string,
): void {
	if (highlightTimer) {
		window.clearTimeout(highlightTimer);
	}
	highlightTimer = window.setTimeout(() => {
		highlightTimer = null;
		const lineEl = findEditorLineEl(view, editor, targetLine, hint);
		if (!lineEl) return;

		// 重置 animation（连续点击时重新播放）
		lineEl.classList.remove('sfc-jump-flash');
		void lineEl.offsetWidth;
		lineEl.classList.add('sfc-jump-flash');
		currentHighlightEl = lineEl;

		// 1500ms 后移除高亮 class
		window.setTimeout(() => {
			if (currentHighlightEl === lineEl) {
				lineEl.classList.remove('sfc-jump-flash');
				currentHighlightEl = null;
			}
		}, 1500);
	}, 500);
}

// ────────────────────────────────────────────────────────────────
// 工具函数
// ────────────────────────────────────────────────────────────────

/**
 * 轮询等待 MarkdownView 的 editor 就绪
 */
async function waitForEditor(
	view: MarkdownView,
	maxAttempts = 30,
): Promise<MarkdownView['editor'] | null> {
	for (let i = 0; i < maxAttempts; i++) {
		if (view.editor) return view.editor;
		await new Promise((r) => window.setTimeout(r, 50));
	}
	return null;
}
