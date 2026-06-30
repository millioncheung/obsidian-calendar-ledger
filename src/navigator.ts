import { MarkdownView, WorkspaceLeaf, type Plugin } from 'obsidian';

/**
 * 跳转到 Calendar.md 指定行
 *
 * 编辑模式 / 阅读模式行为统一：
 *   - smooth 滚动动画（手动 rAF，不依赖 scroll-behavior: smooth）
 *   - 目标行居中显示
 *   - 目标行黄色闪烁高亮
 *
 * 光标位置（仅编辑模式）：
 *   - 空日期 `- **06-16 Tue**`：光标在日期后（行末）
 *   - 有内容 `- **06-16 Tue** | #fitness 胸肩`：光标在内容后（行末）
 *
 * @param line 0-based 行号
 * @param hint 日期标题（如 "06-16 Tue"），阅读模式下用于文本查找定位目标 li
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
		if (!targetLeaf) {
			targetLeaf = plugin.app.workspace.getLeaf('tab');
			await targetLeaf.openFile(file, { active: true, eState: { line } });
		} else {
			plugin.app.workspace.revealLeaf(targetLeaf);
		}

		// 3. 激活 leaf
		plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

		const view = targetLeaf.view;
		if (!(view instanceof MarkdownView)) return;

		// 4. 等待视图稳定
		await new Promise((r) => setTimeout(r, 80));

		// 5. 根据模式分别处理（两种模式行为统一：动画 + 居中 + 高亮）
		if (view.getMode() === 'preview') {
			await previewNavigate(view, line, hint);
		} else {
			await sourceNavigate(view, line);
		}
	} catch (e) {
		console.error('[SFC] navigateToCalendarLine error:', e);
	}
}

// ────────────────────────────────────────────────────────────────
// 阅读模式
// ────────────────────────────────────────────────────────────────

/**
 * 阅读模式：定位目标 li → smooth 居中滚动 → 闪烁高亮
 *
 * 查找策略（按可靠性排序）：
 *   1. hint 文本精确匹配 —— textContent.trim() 以 hint 开头
 *   2. hint 文本模糊匹配 —— includes
 *   3. data-line 匹配 —— 仅在无 hint 时使用
 */
async function previewNavigate(
	view: MarkdownView,
	line: number,
	hint?: string,
): Promise<void> {
	const findEl = (): HTMLElement | null => {
		// 1. hint 文本查找
		if (hint) {
			const lis = view.contentEl.querySelectorAll<HTMLElement>('li');
			for (let i = 0; i < lis.length; i++) {
				const li = lis[i]!;
				if ((li.textContent || '').trim().startsWith(hint)) return li;
			}
			for (let i = 0; i < lis.length; i++) {
				const li = lis[i]!;
				if ((li.textContent || '').includes(hint)) return li;
			}
		}
		// 2. data-line（无 hint 时）
		return view.contentEl.querySelector<HTMLElement>(`[data-line="${line}"]`);
	};

	let el = findEl();
	if (!el) {
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setTimeout(r, 50));
			el = findEl();
			if (el) break;
		}
	}

	if (!el) {
		view.setEphemeralState({ line });
		return;
	}

	const scroller = view.contentEl.querySelector<HTMLElement>('.markdown-preview-view');
	centerScrollAndFlash(scroller, el, () => el!.scrollIntoView({ block: 'center' }));
}

// ────────────────────────────────────────────────────────────────
// 编辑模式
// ────────────────────────────────────────────────────────────────

/**
 * 编辑模式：设置光标 → 定位 .cm-line → smooth 居中滚动 → 闪烁高亮
 */
async function sourceNavigate(
	view: MarkdownView,
	line: number,
): Promise<void> {
	const editor = await waitForEditor(view);
	if (!editor) return;

	const lastLine = editor.lastLine();
	const targetLine = Math.min(line, lastLine);
	const lineContent = editor.getLine(targetLine);
	const pos = { line: targetLine, ch: lineContent.length };

	// 设置光标（不触发自动滚动，保留原始滚动位置作为动画起点）
	const cm = (editor as any).cm;
	if (cm?.dispatch && cm?.state) {
		const lineObj = cm.state.doc.line(targetLine + 1);
		const cmPos = lineObj.from + lineObj.text.length;
		cm.dispatch({ selection: { anchor: cmPos, head: cmPos } });
	} else {
		editor.setCursor(pos);
	}
	editor.focus();

	// 等待一帧让 CM6 渲染光标行的 DOM
	await new Promise((r) => requestAnimationFrame(() => r(null)));

	// 定位目标行的 .cm-line 元素
	const el = findEditorLineEl(view, editor, targetLine);
	const scroller = view.contentEl.querySelector<HTMLElement>('.cm-scroller');

	centerScrollAndFlash(scroller, el, () => editor.scrollIntoView({ from: pos, to: pos }, true));
}

/**
 * 通过 CM6 domAtPos 定位目标行的 .cm-line 元素
 */
function findEditorLineEl(
	view: MarkdownView,
	editor: MarkdownView['editor'],
	line: number,
): HTMLElement | null {
	const cm = (editor as any).cm;
	if (!cm?.domAtPos || !cm?.state) return null;
	try {
		const lineObj = cm.state.doc.line(line + 1);
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
	return null;
}

// ────────────────────────────────────────────────────────────────
// 共用：居中 + smooth 动画 + 高亮
// ────────────────────────────────────────────────────────────────

/**
 * 统一的居中 + smooth 滚动 + 闪烁高亮
 *
 * @param scroller 滚动容器（.cm-scroller 或 .markdown-preview-view）
 * @param el 目标行元素（.cm-line 或 li）
 * @param fallback scroller 或 el 为 null 时的兜底滚动方式
 */
function centerScrollAndFlash(
	scroller: HTMLElement | null,
	el: HTMLElement | null,
	fallback: () => void,
): void {
	if (!el) {
		fallback();
		return;
	}
	if (!scroller) {
		el.scrollIntoView({ block: 'center' });
		flashHighlight(el);
		return;
	}

	// 计算目标 scrollTop（让 el 居中）
	const scrollerRect = scroller.getBoundingClientRect();
	const elRect = el.getBoundingClientRect();
	const elTopInScroller = elRect.top - scrollerRect.top + scroller.scrollTop;
	const targetTop = elTopInScroller - scrollerRect.height / 2 + elRect.height / 2;

	// smooth 滚动 + 高亮（高亮在动画开始时就设置）
	smoothScrollTo(scroller, targetTop, 350);
	flashHighlight(el);
}

/**
 * 手动 rAF smooth 滚动动画
 *
 * 不依赖 scrollTo({ behavior: 'smooth' })：
 *   - .cm-scroller 的 scroll-behavior 可能被 CM6 干预或 CSS 覆盖
 *   - .markdown-preview-view 的原生 smooth 在某些时序下不稳定
 * 手动逐帧设置 scrollTop 最可靠，两种模式行为完全一致。
 */
function smoothScrollTo(scroller: HTMLElement, targetTop: number, duration = 350): void {
	const startTop = scroller.scrollTop;
	const distance = targetTop - startTop;
	if (Math.abs(distance) < 1) return;

	const startTime = performance.now();
	const animate = (now: number): void => {
		const progress = Math.min((now - startTime) / duration, 1);
		// easeInOutCubic
		const eased =
			progress < 0.5
				? 4 * progress * progress * progress
				: 1 - Math.pow(-2 * progress + 2, 3) / 2;
		scroller.scrollTop = startTop + distance * eased;
		if (progress < 1) {
			requestAnimationFrame(animate);
		}
	};
	requestAnimationFrame(animate);
}

/**
 * 给元素添加黄色闪烁高亮，结束后自动清理
 *
 * 用 inline style + box-shadow inset 模拟 background：
 *   1. inline style 优先级最高，能覆盖主题的 .cm-activeLine 默认背景
 *   2. box-shadow inset 不会被元素的 background-color 覆盖
 *   3. 同时兼容阅读模式（li）和编辑模式（.cm-line）
 */
function flashHighlight(el: HTMLElement): void {
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
		el.style.boxShadow = '';
		el.style.transition = '';
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
