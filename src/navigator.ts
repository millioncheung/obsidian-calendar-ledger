import { MarkdownView, WorkspaceLeaf, type Plugin } from 'obsidian';

/**
 * 跳转到 Calendar.md 指定行
 *
 * 统一切换到编辑模式，行为：
 *   - 光标置于行末（日期后 / 内容后），方便编辑
 *   - rAF smooth 滚动动画（easeOutCubic 缓动）
 *   - 目标行居中显示
 *   - 滚动完成后目标行黄色闪烁高亮（避免滚动期间大面积阴影重绘导致卡顿）
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

		// 2. 没有则新建 tab 打开
		//    不传 eState: { line } —— 它会触发 Obsidian 原生跳转高亮（短行 flash），
		//    与本插件的 flashHighlight 叠加成两层，且原生高亮不会自动清除。
		//    后续步骤 6-10 会自己处理光标、滚动和高亮。
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

		// 6. 设置光标到行末（空日期=日期后，有内容=内容后）
		const targetLine = Math.min(line, editor.lastLine());
		const lineContent = editor.getLine(targetLine);
		const pos = { line: targetLine, ch: lineContent.length };
		editor.setCursor(pos);
		editor.focus();

		// 7. 等待 CM6 渲染（光标行装饰更新 + coordsAtPos 就绪）
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

		const cm = (editor as any).cm;
		const scroller = view.contentEl.querySelector<HTMLElement>('.cm-scroller');

		// 8. 计算目标 scrollTop（用 coordsAtPos，即使目标行未渲染也能估算位置）
		const targetTop = cm && scroller ? computeTargetTop(cm, scroller, targetLine) : null;

		if (targetTop != null && scroller) {
			// 9. rAF smooth 滚动到目标位置
			await smoothScrollTo(scroller, targetTop);
		} else {
			// fallback：CM6 原生 scrollIntoView（瞬间，无动画，但确保目标行进入视口）
			editor.scrollIntoView({ from: pos, to: pos }, true);
			await new Promise((r) => setTimeout(r, 120));
		}

		// 10. 滚动完成后，目标行已渲染且在视口中心，定位并高亮
		const lineEl = findEditorLineEl(view, editor, targetLine, hint);
		if (lineEl) flashHighlight(lineEl);
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
 *
 * @returns 目标 scrollTop，若计算失败返回 null
 */
function computeTargetTop(
	cm: any,
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
 * rAF smooth 滚动（easeOutCubic 缓动）
 *
 * 返回 Promise，动画结束后 resolve。高亮在 resolve 后触发，
 * 避免滚动期间 box-shadow 大面积重绘导致卡顿。
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
			// easeOutCubic：起步快、末段慢，接近 cubic-bezier(0.22, 1, 0.36, 1)
			const eased = 1 - Math.pow(1 - t, 3);
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
// 目标行定位
// ────────────────────────────────────────────────────────────────

/**
 * 定位目标行的 .cm-line 元素
 *
 * 在滚动完成后调用：此时目标行已在视口中心且已渲染，domAtPos 最可靠。
 *
 * 查找顺序：
 *   1. CM6 domAtPos —— 通过源码偏移量直接定位
 *   2. hint 文本匹配 —— 用日期标题 startsWith 匹配（domAtPos 失败时）
 *   3. .cm-activeLine —— 最后兜底
 */
function findEditorLineEl(
	view: MarkdownView,
	editor: MarkdownView['editor'],
	line: number,
	hint?: string,
): HTMLElement | null {
	const cm = (editor as any).cm;

	// 方式 1：CM6 domAtPos（滚动完成后目标行已渲染，此方法最可靠）
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

	// 方式 2：用 hint（日期标题，如 "01-22 Wed"）startsWith 匹配
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
 *
 * 在滚动完成后调用，避免滚动期间大面积阴影重绘导致卡顿。
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
