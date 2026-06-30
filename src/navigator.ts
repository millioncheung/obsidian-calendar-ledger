import { MarkdownView, WorkspaceLeaf, type Plugin } from 'obsidian';

/**
 * 跳转到 Calendar.md 指定行
 *
 * 保留用户当前模式：
 *   - 阅读模式（preview）：通过 data-line 定位 DOM 元素，手动计算 scrollTop 居中 + 闪烁高亮
 *   - 源码模式（source）：setCursor 置于行末，手动计算 scrollTop 居中 + 闪烁高亮
 *
 * 光标位置（仅源码模式）：
 *   - 空日期 `- **06-16 Tue**`：光标在日期后（行末）
 *   - 有内容 `- **06-16 Tue** | #fitness 胸肩`：光标在内容后（行末）
 *
 * @param line 0-based 行号
 * @param hint 日期标题（如 "06-16 Tue"），用于阅读模式下验证 data-line 匹配是否正确，
 *             若不匹配则改用文本查找。避免因 Obsidian 渲染时 data-line 与源码行号
 *             不严格对应而跳到错误位置。
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

		// 2. 没有则新建 tab 打开（eState 让 Obsidian 自动定位到目标行）
		if (!targetLeaf) {
			targetLeaf = plugin.app.workspace.getLeaf('tab');
			await targetLeaf.openFile(file, {
				active: true,
				eState: { line },
			});
		} else {
			plugin.app.workspace.revealLeaf(targetLeaf);
		}

		// 3. 激活 leaf
		plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

		const view = targetLeaf.view;
		if (!(view instanceof MarkdownView)) return;

		// 4. 等待视图稳定（打开文件 / 切换模式后 DOM 需要时间渲染）
		await new Promise((r) => setTimeout(r, 80));

		// 5. 根据模式分别处理
		if (view.getMode() === 'preview') {
			await previewScrollAndFlash(view, line, hint);
			return;
		}

		// 6. 源码模式
		const editor = await waitForEditor(view);
		if (!editor) return;

		const lastLine = editor.lastLine();
		const targetLine = Math.min(line, lastLine);
		const lineContent = editor.getLine(targetLine);
		// 行末：空日期=日期后，有内容=内容后
		const pos = { line: targetLine, ch: lineContent.length };

		// 设置光标（不触发自动滚动，保留原始滚动位置作为动画起点）
		const cm = (editor as any).cm;
		if (cm?.dispatch && cm?.state) {
			const lineObj = cm.state.doc.line(targetLine + 1); // CM6 行号 1-based
			const cmPos = lineObj.from + lineObj.text.length;
			cm.dispatch({
				selection: { anchor: cmPos, head: cmPos },
			});
		} else {
			editor.setCursor(pos);
		}
		editor.focus();

		// 7. smooth 居中滚动 + 高亮（flashSourceLine 在 centerEditorLine 内部调用，
		//    此时目标行在视口内，domAtPos 能找到正确 DOM）
		centerEditorLine(view, editor, pos, targetLine);
	} catch (e) {
		console.error('[SFC] navigateToCalendarLine error:', e);
	}
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

/**
 * 阅读模式：定位目标 li 并居中闪烁
 *
 * 查找策略（按可靠性排序）：
 *   1. hint 文本精确匹配 —— 遍历所有 li，找 textContent.trim() 以 hint 开头的
 *      day bullet 行渲染后 textContent 是 "01-22 Wed" 或 "01-22 Wed | ..."，
 *      用 startsWith 比 includes 更精确，避免匹配到子 li 内容
 *   2. hint 文本模糊匹配 —— 退化到 includes
 *   3. data-line 匹配 —— 仅在无 hint 时使用（data-line 可能不是源码行号）
 */
async function previewScrollAndFlash(
	view: MarkdownView,
	line: number,
	hint?: string,
): Promise<void> {
	const findByText = (): HTMLElement | null => {
		if (!hint) return null;
		const lis = view.contentEl.querySelectorAll<HTMLElement>('li');
		// 1. 精确匹配：textContent.trim() 以 hint 开头
		for (let i = 0; i < lis.length; i++) {
			const li = lis[i]!;
			const text = (li.textContent || '').trim();
			if (text.startsWith(hint)) {
				return li;
			}
		}
		// 2. 模糊匹配：includes
		for (let i = 0; i < lis.length; i++) {
			const li = lis[i]!;
			if ((li.textContent || '').includes(hint)) {
				return li;
			}
		}
		return null;
	};

	const findByDataLine = (): HTMLElement | null => {
		// 仅在无 hint 时用 data-line（data-line 可能不是源码行号，不可靠）
		if (hint) return null;
		return view.contentEl.querySelector<HTMLElement>(`[data-line="${line}"]`);
	};

	const findEl = (): HTMLElement | null => {
		return findByText() || findByDataLine();
	};

	let el = findEl();
	if (!el) {
		// 等待渲染完成（首次打开时阅读模式 DOM 可能还没生成）
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setTimeout(r, 50));
			el = findEl();
			if (el) break;
		}
	}

	if (!el) {
		// fallback：让 Obsidian 自己尝试滚动
		view.setEphemeralState({ line });
		return;
	}

	// 用原生 scrollIntoView 居中 + smooth 滚动（比手动计算更可靠）
	centerPreviewEl(view, el);
	flashHighlight(el);
}

/**
 * 阅读模式：用原生 scrollIntoView 居中 + smooth 滚动
 *
 * 之前手动计算 getBoundingClientRect + scrollTo，在 DOM 布局未完成时位置不准。
 * 原生 scrollIntoView 由浏览器计算位置，更可靠。用 rAF 等待一帧确保布局稳定。
 */
function centerPreviewEl(view: MarkdownView, el: HTMLElement): void {
	requestAnimationFrame(() => {
		el.scrollIntoView({ block: 'center', behavior: 'smooth' });
	});
}

/**
 * 源码模式：smooth 居中滚动
 *
 * 之前依赖 .cm-activeLine 定位，但旧的 .cm-activeLine 可能还在 DOM 中，
 * 导致计算出的 targetTop 跟当前位置几乎一样，smoothScrollTo 不做动画。
 *
 * 现在的流程：
 *   1. 记录原始 scrollTop（动画起点）
 *   2. editor.scrollIntoView(pos, false) 瞬间滚到目标行附近（让目标行进入视口，
 *      确保 coordsAtPos 返回有效坐标）
 *   3. editor.coordsAtPos(pos) 获取目标行的精确坐标
 *   4. 计算 targetTop（居中位置）
 *   5. 恢复 scrollTop 到原始位置
 *   6. 设置 scroll-behavior: smooth，用 scrollTo smooth 滚动到 targetTop
 *
 * 这样从原始位置 smooth 滚动到目标居中位置，动画距离完整。
 */
function centerEditorLine(
	view: MarkdownView,
	editor: MarkdownView['editor'],
	pos: { line: number; ch: number },
	targetLine: number,
): void {
	const scroller = view.contentEl.querySelector<HTMLElement>('.cm-scroller');
	if (!scroller) return;

	// 1. 记录原始位置
	const originalScrollTop = scroller.scrollTop;

	// 2. 瞬间滚到目标行附近（不居中，只让目标行进入视口）
	editor.scrollIntoView({ from: pos, to: pos }, false);

	// 2.5 高亮目标行 —— 此时目标行刚进入视口，CM6 domAtPos 能找到正确 DOM
	//     （之后步骤5会恢复 scrollTop，目标行离开视口，domAtPos 会失效）
	flashSourceLine(view, editor, targetLine);

	// 3. 获取目标行坐标（通过 CM6 coordsAtPos，返回相对视口的坐标）
	const cm = (editor as any).cm;
	let coords: { top: number; bottom: number } | null = null;
	if (cm?.coordsAtPos && cm?.state) {
		const lineObj = cm.state.doc.line(pos.line + 1); // CM6 行号 1-based
		const offset = lineObj.from + pos.ch;
		coords = cm.coordsAtPos(offset);
	}
	if (!coords) {
		// fallback：coordsAtPos 失败，直接居中（无动画）
		editor.scrollIntoView({ from: pos, to: pos }, true);
		return;
	}

	// 4. 计算居中位置
	const scrollerRect = scroller.getBoundingClientRect();
	const lineHeight = coords.bottom - coords.top;
	const lineTopInContent = coords.top - scrollerRect.top + scroller.scrollTop;
	const targetTop = lineTopInContent - scrollerRect.height / 2 + lineHeight / 2;

	// 5. 恢复原始位置（为 smooth 动画提供完整起点）
	scroller.scrollTop = originalScrollTop;

	// 6. 下一帧 smooth 滚动到居中位置
	//    用 rAF 确保步骤 5 的 scrollTop 恢复已生效
	requestAnimationFrame(() => {
		const original = scroller.style.scrollBehavior;
		scroller.style.scrollBehavior = 'smooth';
		scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
		// 动画结束后恢复 scroll-behavior
		setTimeout(() => {
			scroller.style.scrollBehavior = original;
		}, 600);
	});
}

/**
 * 源码模式：闪烁目标行
 *
 * 查找顺序：
 *   1. CM6 `domAtPos` API —— 通过源码偏移量直接定位目标行 DOM（最可靠，不依赖 .cm-activeLine）
 *   2. 轮询等待 `.cm-activeLine` —— 兜底（domAtPos 失败时）
 */
function flashSourceLine(
	view: MarkdownView,
	editor: MarkdownView['editor'],
	line: number,
): void {
	// 方式 1（优先）：通过 CM6 domAtPos 定位目标行的 DOM 元素
	// 不依赖 .cm-activeLine：dispatch 后旧光标行可能还带着 .cm-activeLine class，
	// 会高亮错误的行。domAtPos 直接按源码偏移量定位，最可靠。
	const cm = (editor as any).cm;
	if (cm?.domAtPos && cm?.state) {
		try {
			// CM6 doc.line(n) 行号是 1-based
			const lineObj = cm.state.doc.line(line + 1);
			const dom = cm.domAtPos(lineObj.from);
			let node: Node | null = dom.node;
			if (node && node.nodeType === Node.TEXT_NODE) {
				node = node.parentElement;
			}
			if (node) {
				const lineEl = (node as HTMLElement).closest('.cm-line');
				if (lineEl) {
					flashHighlight(lineEl as HTMLElement);
					return;
				}
			}
		} catch {
			// ignore，进入 fallback
		}
	}

	// 方式 2：轮询等待 .cm-activeLine 出现（兜底）
	const tryFlash = (attempts: number) => {
		const el = view.contentEl.querySelector<HTMLElement>('.cm-activeLine');
		if (el) {
			flashHighlight(el);
			return;
		}
		if (attempts > 0) {
			setTimeout(() => tryFlash(attempts - 1), 30);
		}
	};
	tryFlash(10);
}

/**
 * 给元素添加黄色闪烁高亮，结束后自动清理
 *
 * 使用 inline style + box-shadow inset 模拟 background，而不是 CSS class + animation：
 *   1. inline style 优先级最高，能覆盖主题的 .cm-activeLine 默认背景
 *      （keyframes 中不允许 !important，无法覆盖主题的 !important 规则）
 *   2. box-shadow inset 不会被元素的 background-color 覆盖
 *   3. 同时兼容阅读模式（li / p 等元素）和源码模式（.cm-line）
 */
function flashHighlight(el: HTMLElement): void {
	// 清理之前可能残留的动画状态
	el.style.transition = 'none';
	el.style.boxShadow = '';
	// 触发重排，确保下面的设置从干净状态开始
	void el.offsetWidth;

	// 设置初始高亮（inline style 优先级最高，覆盖主题样式）
	el.style.boxShadow =
		'inset 0 0 0 100px rgba(255, 213, 79, 0.5), 0 0 0 1px rgba(255, 213, 79, 0.7)';

	// 下一帧启用 transition 淡出
	requestAnimationFrame(() => {
		el.style.transition = 'box-shadow 1.8s ease-out';
		el.style.boxShadow =
			'inset 0 0 0 100px transparent, 0 0 0 1px transparent';
	});

	// 动画结束后清理 inline style，恢复主题默认样式
	setTimeout(() => {
		el.style.boxShadow = '';
		el.style.transition = '';
	}, 1900);
}
