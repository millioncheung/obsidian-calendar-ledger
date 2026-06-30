import { MarkdownView, WorkspaceLeaf, type Plugin } from 'obsidian';

/**
 * 跳转到 Calendar.md 指定行
 *
 * 统一切换到编辑模式，行为：
 *   - 光标置于行末（日期后 / 内容后），方便编辑
 *   - rAF smooth 滚动动画（easeOutCubic 缓动，完整从原位置滚到目标位置）
 *   - 目标行居中显示
 *   - 滚动过程中目标行进入视口后立即高亮（与滚动同时，无 delay）
 *
 * 关键设计：
 *   - 用 cm.dispatch + scrollIntoView: false 设置光标，禁止 CM6 自动瞬间滚动
 *   - 用 lineBlockAt 计算目标 scrollTop（不需要目标行已渲染）
 *   - 用 posAtDOM 验证 domAtPos 返回的元素确实属于目标行，避免虚拟滚动
 *     场景下定位到视口边缘的错误行
 *
 * @param line 0-based 行号
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

		// 2. 没有则新建 tab 打开（不传 eState，避免 Obsidian 原生跳转高亮叠加）
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

		const cm = (editor as any).cm;
		const scroller = view.contentEl.querySelector<HTMLElement>('.cm-scroller');

		// 6. 设置光标到行末，但不触发 CM6 自动滚动
		const targetLine = Math.min(line, editor.lastLine());
		const lineContent = editor.getLine(targetLine);
		const pos = { line: targetLine, ch: lineContent.length };
		setCursorWithoutScroll(cm, editor, targetLine);
		editor.focus();

		// 7. 等一帧，让 CM6 更新 active line 装饰
		await new Promise((r) => requestAnimationFrame(r));

		// 8. 计算目标 scrollTop（lineBlockAt 不需要目标行已渲染）
		const targetTop = cm && scroller ? computeTargetTop(cm, scroller, targetLine) : null;

		if (targetTop != null && scroller) {
			// 9. 启动 smooth 滚动（不 await，与高亮轮询并行）
			const scrollPromise = smoothScrollTo(scroller, targetTop);
			// 10. 同时轮询定位行元素：目标行进入视口被渲染后立即高亮
			await pollAndHighlight(view, editor, targetLine, hint);
			await scrollPromise;
		} else {
			// fallback：CM6 原生 scrollIntoView
			editor.scrollIntoView({ from: pos, to: pos }, true);
			await new Promise((r) => setTimeout(r, 120));
			const lineEl = findEditorLineEl(view, editor, targetLine, hint);
			if (lineEl) flashHighlight(lineEl);
		}
	} catch (e) {
		console.error('[SFC] navigateToCalendarLine error:', e);
	}
}

// ────────────────────────────────────────────────────────────────
// 光标设置
// ────────────────────────────────────────────────────────────────

/**
 * 设置光标到目标行行末，但禁止 CM6 自动滚动
 *
 * editor.setCursor 会触发 CM6 的 scrollIntoView，把光标行瞬间拉入视口，
 * 破坏 smoothScrollTo 的完整动画。改用 cm.dispatch + scrollIntoView: false。
 */
function setCursorWithoutScroll(
	cm: any,
	editor: MarkdownView['editor'],
	line: number,
): void {
	if (cm?.state) {
		try {
			const lineObj = cm.state.doc.line(line + 1); // CM6 行号 1-based
			const ES = cm.state.selection.constructor; // EditorSelection 类
			cm.dispatch({
				selection: ES.cursor(lineObj.to), // 行末
				scrollIntoView: false,
			});
			return;
		} catch {
			// fallback 到 editor.setCursor
		}
	}
	const lineContent = editor.getLine(line);
	editor.setCursor({ line, ch: lineContent.length });
}

// ────────────────────────────────────────────────────────────────
// 位置计算 + 滚动
// ────────────────────────────────────────────────────────────────

/**
 * 计算让目标行居中的 scrollTop
 *
 * 优先用 coordsAtPos（行已渲染时精确），失败则用 lineBlockAt（行未渲染时
 * 通过文档结构估算）。lineBlockAt 使得远距离跳转也能计算目标位置。
 */
function computeTargetTop(
	cm: any,
	scroller: HTMLElement,
	line: number,
): number | null {
	try {
		const lineObj = cm.state.doc.line(line + 1);
		const scrollerRect = scroller.getBoundingClientRect();

		// 方式 1：coordsAtPos（行已渲染时精确）
		if (cm.coordsAtPos) {
			const coords = cm.coordsAtPos(lineObj.from);
			if (coords) {
				const lineMid = (coords.top + coords.bottom) / 2;
				return lineMid - scrollerRect.top + scroller.scrollTop - scrollerRect.height / 2;
			}
		}

		// 方式 2：lineBlockAt（行未渲染时用文档结构估算）
		if (cm.lineBlockAt) {
			const block = cm.lineBlockAt(lineObj.from);
			return block.top + block.height / 2 - scrollerRect.height / 2;
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * rAF smooth 滚动（easeOutCubic 缓动）
 */
function smoothScrollTo(scroller: HTMLElement, targetTop: number): Promise<void> {
	return new Promise((resolve) => {
		const startTop = scroller.scrollTop;
		const distance = targetTop - startTop;
		if (Math.abs(distance) < 2) {
			resolve();
			return;
		}

		const duration = 400;
		const startTime = performance.now();

		const step = (now: number) => {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / duration, 1);
			const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
			scroller.scrollTop = startTop + distance * eased;
			if (t < 1) {
				requestAnimationFrame(step);
			} else {
				resolve();
			}
		};
		requestAnimationFrame(step);
	});
}

// ────────────────────────────────────────────────────────────────
// 目标行定位 + 高亮轮询
// ────────────────────────────────────────────────────────────────

/**
 * 轮询定位目标行元素，定位成功后立即高亮
 *
 * 滚动过程中目标行逐渐进入视口被 CM6 渲染，一旦 domAtPos + posAtDOM
 * 验证通过就高亮，实现"滚动到位即高亮"，无 delay。
 */
async function pollAndHighlight(
	view: MarkdownView,
	editor: MarkdownView['editor'],
	line: number,
	hint?: string,
): Promise<void> {
	for (let i = 0; i < 15; i++) {
		const lineEl = findEditorLineEl(view, editor, line, hint);
		if (lineEl) {
			flashHighlight(lineEl);
			return;
		}
		await new Promise((r) => setTimeout(r, 30));
	}
	// 最后再试一次（滚动刚结束）
	const lineEl = findEditorLineEl(view, editor, line, hint);
	if (lineEl) flashHighlight(lineEl);
}

/**
 * 定位目标行的 .cm-line 元素
 *
 * 用 posAtDOM 验证 domAtPos 返回的元素确实属于目标行：
 *   - CM6 虚拟滚动下，目标行未渲染时 domAtPos 返回视口边缘的错误行
 *   - posAtDOM 获取该 DOM 元素对应的文档偏移量，验证是否在目标行范围内
 *
 * 查找顺序：
 *   1. CM6 domAtPos + posAtDOM 验证（最可靠）
 *   2. hint 文本 startsWith 匹配 + posAtDOM 验证
 */
function findEditorLineEl(
	view: MarkdownView,
	editor: MarkdownView['editor'],
	line: number,
	hint?: string,
): HTMLElement | null {
	const cm = (editor as any).cm;
	if (!cm?.state) return null;

	let lineObj;
	try {
		lineObj = cm.state.doc.line(line + 1); // CM6 行号 1-based
	} catch {
		return null;
	}

	// 方式 1：CM6 domAtPos + posAtDOM 验证
	if (cm.domAtPos && cm.posAtDOM) {
		try {
			const dom = cm.domAtPos(lineObj.from);
			let node: Node | null = dom.node;
			if (node && node.nodeType === Node.TEXT_NODE) {
				node = node.parentElement;
			}
			if (node) {
				const lineEl = (node as HTMLElement).closest('.cm-line') as HTMLElement | null;
				if (lineEl && isLineElAtPos(cm, lineEl, lineObj.from, lineObj.to)) {
					return lineEl;
				}
			}
		} catch {
			// ignore
		}
	}

	// 方式 2：hint 文本 startsWith 匹配 + posAtDOM 验证
	if (hint) {
		const lines = view.contentEl.querySelectorAll<HTMLElement>('.cm-line');
		for (let i = 0; i < lines.length; i++) {
			const el = lines[i]!;
			const text = (el.textContent || '').trim();
			if (text.startsWith(hint) && isLineElAtPos(cm, el, lineObj.from, lineObj.to)) {
				return el;
			}
		}
	}

	return null;
}

/**
 * 验证 .cm-line 元素对应的文档位置是否在目标行范围内
 *
 * 防止虚拟滚动场景下 domAtPos / hint 匹配到视口边缘的错误行。
 */
function isLineElAtPos(cm: any, el: HTMLElement, lineFrom: number, lineTo: number): boolean {
	try {
		const pos = cm.posAtDOM(el);
		return pos >= lineFrom && pos <= lineTo;
	} catch {
		return false;
	}
}

// ────────────────────────────────────────────────────────────────
// 高亮
// ────────────────────────────────────────────────────────────────

let currentHighlightEl: HTMLElement | null = null;

function clearCurrentHighlight(): void {
	if (currentHighlightEl) {
		currentHighlightEl.style.boxShadow = '';
		currentHighlightEl.style.transition = '';
		currentHighlightEl = null;
	}
}

/**
 * 给元素添加黄色闪烁高亮，结束后自动清理
 *
 * 用 inline style + box-shadow inset 模拟 background：
 *   1. inline style 优先级最高，能覆盖主题的 .cm-activeLine 默认背景
 *   2. box-shadow inset 不会被元素的 background-color 覆盖
 */
function flashHighlight(el: HTMLElement): void {
	clearCurrentHighlight();
	currentHighlightEl = el;

	el.style.transition = 'none';
	el.style.boxShadow = '';
	void el.offsetWidth;

	el.style.boxShadow =
		'inset 0 0 0 100px rgba(255, 213, 79, 0.5), 0 0 0 1px rgba(255, 213, 79, 0.7)';

	requestAnimationFrame(() => {
		el.style.transition = 'box-shadow 1.8s ease-out';
		el.style.boxShadow =
			'inset 0 0 0 100px transparent, 0 0 0 1px transparent';
	});

	setTimeout(() => {
		if (currentHighlightEl === el) {
			el.style.boxShadow = '';
			el.style.transition = '';
			currentHighlightEl = null;
		}
	}, 1900);
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
		await new Promise((r) => setTimeout(r, 50));
	}
	return null;
}
