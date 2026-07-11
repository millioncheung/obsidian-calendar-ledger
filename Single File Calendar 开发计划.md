# Single File Calendar 开发计划

## 1. 项目目标

做一个 Obsidian 插件，用一份 `Calendar.md` 承载全年日期、日常记录、未来事项、跨日期事件、统计和轻量可视化。

核心原则：

* 不创建 Daily Note
* 不为每天生成单独文件
* 所有日期内容都保存在同一个 `Calendar.md`
* 正文仍然是可读、可编辑的 Markdown
* 插件只负责生成、解析、筛选、统计、可视化和跳转
* 标签负责分类
* 双链负责具体事件
* 跨日期事件只写一次，不重复记录

---

## 2. 当前实现状态

当前代码已经不再停留在早期 `V1 / V2` 阶段，实际 Sidebar 已包含：

```text
Content | Upcoming | Stats | Heatmap | Year
```

当前优先级：

```text
先稳定现有 V2/V3/V4/Year 体验
再补文档、边界处理和交互一致性
最后再考虑自动年度总结 / 导出
```

已明确保持现状：

* `Calendar.md` 中的 `Wxx` 周编号使用 ISO 周，固定星期一开始
* `weekStartsOn` 只影响热力图等可视化布局
* 插件设置页文案跟随插件自己的 `language` 设置，不读取 Obsidian 全局语言
* 多层目录自动创建暂不作为核心需求；默认 `Calendar.md` 和已存在文件夹路径优先支持

---

## 3. Calendar.md 当前结构

当前生成器使用年份作为顶层标题，不再生成 `# Calendar` 包裹标题。

```md
# 2026

## Jan

### W01

- **01-01 Thu**
- **01-02 Fri**
- **01-03 Sat**

## Feb

### W06

- **02-01 Sun**
- **02-02 Mon**
```

规则：

* 年份使用 `# 2026`
* 月份使用 `## Jan`
* 周标题使用 `### Wxx`，可通过设置隐藏
* 日期使用一级 bullet
* 日期格式固定为 `- **MM-DD Weekday**`
* 日期和内容之间使用英文半角竖线 `|`
* 同一天多条内容使用中文分号 `；` 分隔
* 不覆盖已有记录
* 兼容旧格式解析和迁移

---

## 4. 推荐记录格式

空日期：

```md
- **06-15 Mon**
```

单条记录：

```md
- **06-16 Tue** | #fitness 胸肩
```

多条记录：

```md
- **06-16 Tue** | #fitness 胸肩；#live [[演唱会]]
```

跨日期事件只在开始日期写一次：

```md
- **06-15 Mon** | #travel Zhongshan 06-15~06-27
```

跨日期事件和当天事件可以分开记录：

```md
- **06-15 Mon** | #travel Zhongshan 06-15~06-27；#flight 上海虹桥 → 珠海 21:35-23:55
- **06-27 Sat** | #flight 珠海 → 上海浦东 14:45-17:15
```

---

## 5. 已实现功能

### 5.1 Calendar 文件生成

已实现：

* Generate Calendar
* Overwrite Calendar，带确认弹窗
* Append Year
* Append Year 成功后自动同步并保存 `endYear`
* 显示 / 隐藏周数后自动重建结构，并保留已有内容

保持现状：

* `Calendar.md` 中 `Wxx` 始终使用 ISO 周
* 多层目录缺失时不保证自动逐级创建

### 5.2 日期跳转与写入

已实现：

* Jump to Today
* Jump to Date
* Add Item to Date
* Add Item to Today
* 日期输入兼容 `2026-7-3` / `2026-07-03` 等格式
* 跳转统一打开 `Calendar.md`，切到编辑模式，滚动并高亮目标行
* 添加内容默认写入 inline，使用 `|` 和 `；`

### 5.3 Parser

已实现：

* 解析新格式 `# year / ## month / ### week / - **MM-DD Weekday**`
* 兼容旧格式完整日期 bullet
* 兼容旧 heading day 格式
* 提取 inline 内容
* 提取标签
* 提取双链
* 提取日期范围
* 构建 `dayBlocks` 和 `dayBlockMap`

当前结构：

```ts
type CalendarDayBlock = {
  date: string;
  title: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  hasContent: boolean;
  inlineContent: string;
  hasInline: boolean;
  hasSubBullets: boolean;
  tags: string[];
  links: string[];
  ranges: CalendarRange[];
};
```

---

## 6. Sidebar 当前结构

当前 Sidebar：

```text
Content | Upcoming | Stats | Heatmap | Year
```

通用行为：

* Refresh 按钮刷新解析数据
* 点击列表项跳转到对应日期行
* 跨日期延续日跳转到 range 开始日期行
* Stats / Heatmap 折叠状态会保存，切换 tab 和重启后保留

不再保留：

* Calendar 树形大纲 tab
* Nav tab
* Year / Month / Week / Day 导航按钮
* `defaultOutlineLevel` 设置

---

## 7. Content Tab

Content Tab 只显示有内容的日期。

要求 / 当前行为：

* 不显示空日期
* 按日期升序
* 保留原始日期行标题
* 显示 inline 内容
* 点击 item 跳转到对应日期行末尾

示例：

```text
06-15 Mon  #travel Zhongshan 06-15~06-27；#flight 上海虹桥 → 珠海
06-16 Tue  #fitness 胸肩
06-18 Thu  #fitness 背手臂
```

---

## 8. Upcoming Tab

Upcoming Tab 显示未来事项和正在进行中的跨日期事件。

当前规则：

* 显示今天及之后的内容
* 正在进行中的跨日期事件继续显示
* 已过期内容不显示
* 跨日期事件展开显示覆盖日期
* 去重按 inline item 粒度处理，不按整天过滤
* 如果某天被 range 覆盖，但当天还有独立 `#flight` / `#live` / 其他事项，该独立事项仍然显示

示例：

```md
- **06-15 Mon** | #travel Zhongshan 06-15~06-27
- **06-27 Sat** | #flight 珠海 → 上海浦东 14:45-17:15
```

Upcoming 中应同时保留：

```text
06-15 Mon  #travel Zhongshan
06-16 Tue  ↳
...
06-27 Sat  ↳
06-27 Sat  #flight 珠海 → 上海浦东 14:45-17:15
```

---

## 9. Stats Tab

Stats Tab 基于实际标签扫描和设置中的可视化映射动态生成。

当前能力：

* 扫描 `Calendar.md` 中真实存在的标签
* 使用 `enabledStatsTags` 控制 Stats 中显示哪些标签
* 根据 `visualizationTagMappings` 判定标签类型
* 支持 activity / event / monthly / range / simple
* 支持 Monthly Summary
* section 和 activity 月份行支持折叠状态记忆
* item 点击跳转到对应日期

标签类型语义：

```text
activity  每次出现计数，适合 #fitness
event     事件列表，适合 #live
monthly   按月分布，适合 #flight
range     跨日期范围，适合 #travel / #I-go / #She-come
simple    未映射标签，按普通出现记录展示
```

---

## 10. Heatmap Tab

Heatmap Tab 是轻量 DOM / CSS 可视化，不引入复杂图表库。

当前能力：

* Activity Heatmap
* Event Timeline
* Monthly Distribution
* Range View
* 支持年份选择
* 根据 `visualizationTagMappings` 动态决定展示模块
* 折叠状态持久化
* 点击可视化 item 跳转到对应日期

`weekStartsOn` 当前只影响热力图网格布局，不改变 `Calendar.md` 的 ISO `Wxx` 周编号。

---

## 11. Year Tab

Year Tab 是当前的年度概览，不等同于完整自动年度总结。

当前能力：

* 年份选择
* Summary Cards
* Year Timeline
* Year Data Overview
* 年度卡片可在设置中配置
* range 标签可选择显示事件次数和总天数
* 点击年度 timeline item 跳转到对应日期

暂未实现：

* 自动生成自然语言年度总结
* 导出 `Year Review 2026.md`
* 复制年度总结到剪贴板

---

## 12. 设置页

当前设置：

* Calendar file path
* Start year
* End year
* Week starts on
* Calendar content language
* Show week number
* Stats tags
* Visualization tag mappings
* Year Summary cards
* Generate calendar file

已移除：

* `dateHeadingFormat`
* `defaultOutlineLevel`

语言规则：

* 设置页文案跟随插件自己的 `language`
* `language = zh` 时设置页显示中文
* `language = en` 时设置页显示英文
* `language` 同时影响生成日期行中的星期名称

---

## 13. 标签体系

推荐基础标签：

```md
#fitness
#live
#flight
#travel
#I-go
#She-come
```

标签负责分类：

```md
#live
#travel
```

双链负责具体事件：

```md
[[泰e电音节]]
[[曼谷旅行]]
[[The Weeknd Kuala Lumpur]]
```

推荐：

```md
- **12-18 Fri** | #live [[泰e电音节]] 12-18~12-20
```

不推荐：

```md
- **12-18 Fri** | #live 泰e
```

---

## 14. 暂不做内容

暂不做：

* Daily Note
* 系统日历同步
* 系统提醒
* 重复事件
* 拖拽改期
* 自动创建事件详情页
* 自动管理照片 / 票根 / 附件
* 多人协作
* 云同步
* 复杂数据库
* ECharts / D3 等复杂图表库
* 自动年度总结导出

---

## 15. 当前示例

```md
# 2026

## Jun

### W24

- **06-13 Sat**
- **06-14 Sun**
- **06-15 Mon** | #travel Zhongshan 06-15~06-27；#flight 上海虹桥 → 珠海 21:35-23:55
- **06-16 Tue** | #fitness 胸肩
- **06-17 Wed**
- **06-18 Thu** | #fitness 背手臂
- **06-19 Fri**
- **06-20 Sat** | #fitness 臀腿
- **06-21 Sun**
- **06-22 Mon**
- **06-23 Tue** | #fitness 胸肩
- **06-24 Wed** | #fitness 背手臂
- **06-25 Thu**
- **06-26 Fri**
- **06-27 Sat** | #flight 珠海 → 上海浦东 14:45-17:15
- **06-28 Sun**
- **06-29 Mon**
- **06-30 Tue**

## Nov

### W45

- **11-05 Thu** | #travel Kuala Lumpur 11-05~11-08；#live [[The Weeknd]]
- **11-06 Fri**
- **11-07 Sat**
- **11-08 Sun**

## Dec

### W51

- **12-18 Fri** | #live [[泰e电音节]] 12-18~12-20
- **12-19 Sat**
- **12-20 Sun**
```

---

## 16. 后续待办

优先级较高：

* 继续验证 Upcoming item 粒度去重在真实 Calendar.md 中的表现
* 对 Stats / Heatmap / Year 的文案做进一步统一
* 视需要补多层目录逐级创建
* 整理 README / 使用说明

优先级较低：

* 自动生成年度总结 Markdown
* 一键复制年度总结
* 更完整的测试覆盖
* 更精细的可视化交互
