import { MarkdownView, WorkspaceLeaf, type Plugin } from 'obsidian';

/**
 * 跳转到 Calendar.md 指定行
 *
 * 统一切换到编辑模式（不管用户当前是阅读模式还是编辑模式）：
 *   - 编辑模式有 CM6 API，定位精确
 *   - 光标置于行末（日期后 / 内容后），方便编辑
 *   - smooth 滚动动画（手动 rAF）
 *   - 目标行居中显示
 *   - 目标行黄色闪烁高亮
 *
 * @param line 0-based 行号
 * @param hint 日期标题（如 "06-16 Tue"），保留参数兼容调用方
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

		// 4. 统一切换到编辑模式
		const state = view.getState();
		if (state.mode !== 'source') {
			state.mode = 'source';
			await view.setState(state, { history: true });
		}

		// 5. 等待 editor 就绪（模式切换后 editor 需要时间初始化）
		const editor = await waitForEditor(view);
		if (!editor) return;

		// 6. 设置光标到行末（空日期=日期后，有内容=内容后）
		const targetLine = Math.min(line, editor.lastLine());
		const lineContent = editor.getLine(targetLine);
		const pos = { line: targetLine, ch: lineContent.length };
		editor.setCursor(pos);
		editor.focus();

		// 7. 等待 CM6 渲染（.cm-activeLine 更新到新光标行）
		await new Promise((r) => setTimeout(r, 120));

		// 8. 居中 + smooth 动画 + 高亮
		const scroller = view.contentEl.querySelector<HTMLElement>('.cm-scroller');
		const activeLine = view.contentEl.querySelector<HTMLElement>('.cm-activeLine');

		if (!scroller || !activeLine) {
			// fallback：用 Obsidian 原生 scrollIntoView 居中
			editor.scrollIntoView({ from: pos, to: pos }, true);
			return;
		}

		// 计算目标 scrollTop（让 activeLine 居中）
		const scrollerRect = scroller.getBoundingClientRect();
		const lineRect = activeLine.getBoundingClientRect();
		const lineTopInScroller = lineRect.top - scrollerRect.top + scroller.scrollTop;
		const targetTop = lineTopInScroller - scrollerRect.height / 2 + lineRect.height / 2;

		// smooth 滚动 + 高亮
		smoothScrollTo(scroller, targetTop, 350);
		flashHighlight(activeLine);
	} catch (e) {
		console.error('[SFC] navigateToCalendarLine error:', e);
	}
}

// ────────────────────────────────────────────────────────────────
// 工具函数
// ────────────────────────────────────────────────────────────────

/**
 * 手动 rAF smooth 滚动动画
 *
 * 不依赖 scrollTo({ behavior: 'smooth' })：.cm-scroller 的 scroll-behavior
 * 可能被 CM6 干预或 CSS 覆盖。手动逐帧设置 scrollTop 最可靠。
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
