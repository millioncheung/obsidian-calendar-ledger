# Single File Calendar Plugin Plan

## 1. 项目目标

做一个 Obsidian 插件，用一份 `Calendar.md` 承载全年日期、日常记录、未来事项、跨日期事件和年度统计。

核心原则：

* 不创建 Daily Note
* 不为每天生成单独文件
* 所有日期内容都保存在同一个 `Calendar.md`
* 正文仍然是可读、可编辑的 Markdown
* 插件只负责生成、解析、筛选、统计和跳转
* 标签负责分类
* 双链负责具体事件
* 跨日期事件只写一次，不重复记录

---

## 2. 总体版本规划

```text
V1：基础单文件日历
V2：内容筛选 + 未来事项 + 跨日期事件
V3：统计视图
V4：热力图 / 可视化
V5：年度回顾 / 自动总结
```

当前优先级：

```text
先稳定 V2
再做 V3 Stats
最后再考虑 V4 / V5
```

---

# V1：基础单文件日历

## 3. V1 目标

完成最基础的 `Calendar.md` 生成、编辑、跳转和解析。

---

## 4. Calendar.md 基础结构

```md
# Calendar

## 2026

### Jan

- **01-01 Thu**
- **01-02 Fri**
- **01-03 Sat**

### Feb

- **02-01 Sun**
- **02-02 Mon**
```

规则：

* `# Calendar` 只出现一次
* 年份使用 `## 2026`
* 月份使用 `### Jan`
* 日期使用一级 bullet
* 日期格式为 `- **MM-DD Weekday**`
* 不生成 Daily Note
* 不覆盖已有记录

---

## 5. 推荐记录格式

### 5.1 空日期

```md
- **06-15 Mon**
```

### 5.2 单条记录

```md
- **06-16 Tue** | #fitness 胸肩
```

### 5.3 多条记录

同一天多条内容使用中文分号 `；` 分隔。

```md
- **06-16 Tue** | #fitness 胸肩；#live [[演唱会]]
```

### 5.4 分隔符

日期和内容之间使用英文半角竖线：

```md
| 
```

完整格式：

```md
- **06-16 Tue** | #fitness 胸肩
```

不要使用中文全角竖线：

```text
｜
```

---

## 6. V1 功能

### 6.1 Generate Calendar

生成指定年份的 `Calendar.md`。

要求：

* 可生成一年完整日期
* 可指定年份
* 如果文件不存在，则创建
* 如果文件已存在，不覆盖已有内容
* 不重复生成已有年份

---

### 6.2 Append Year

追加新年份。

要求：

* 如果年份不存在，则追加
* 如果年份已存在，不重复生成
* 不覆盖旧内容
* 不重排旧内容

---

### 6.3 Jump to Today

跳转到今天日期。

要求：

* 获取今天日期
* 格式化为 `YYYY-MM-DD`
* 根据 year heading + month heading + day line 还原完整日期
* 打开 `Calendar.md`
* 滚动到对应日期行
* 光标放到日期行末尾

---

### 6.4 Jump to Date

跳转到指定日期。

输入需兼容：

```text
2026-7-3
2026-07-03
2026-7-03
2026-07-3
```

内部统一 normalize 成：

```text
2026-07-03
```

要求：

* 找到目标日期
* 打开 `Calendar.md`
* 滚动到对应日期行
* 光标放到该行末尾

---

### 6.5 Add Item to Date

向指定日期添加内容。

空日期：

```md
- **06-16 Tue**
```

添加后：

```md
- **06-16 Tue** | #fitness 胸肩
```

已有内容：

```md
- **06-16 Tue** | #fitness 胸肩
```

再次添加后：

```md
- **06-16 Tue** | #fitness 胸肩；#live [[演唱会]]
```

要求：

* 默认 inline 写入
* 自动添加 `|`
* 多条内容用 `；`
* 不覆盖已有内容
* 添加后跳转到目标日期
* 光标放到新增内容末尾

---

## 7. V1 Parser

解析 `Calendar.md` 为结构化数据。

```ts
type CalendarDayBlock = {
  date: string;          // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  weekday: string;
  lineStart: number;
  lineEnd: number;
  rawLine: string;
  content: string;
  hasContent: boolean;
  tags: string[];
  links: string[];
  ranges: CalendarRange[];
};
```

要求：

* 能识别空日期
* 能识别 inline 内容
* 能识别标签
* 能识别双链
* 能识别是否有内容
* 能根据年月标题还原完整日期

---

# V2：内容筛选 + 未来事项 + 跨日期事件

## 8. V2 目标

基于 `Calendar.md` 增加右侧 Sidebar 筛选能力，并支持跨日期事件。

最终 Sidebar 只保留：

```text
Content | Upcoming
```

不再保留 Calendar / Nav / Outline tab。

原因：

* 中间正文已经是完整 `Calendar.md`
* Year / Month 跳转可以使用 Obsidian 自带大纲
* 插件 Sidebar 主要负责筛选“有内容”和“未来事项”

---

## 9. Content Tab

Content Tab 只显示有内容的日期。

原始内容：

```md
- **06-15 Mon** | #zhongshan 06-15~06-27；#flight 上海虹桥 → 珠海 21:35-23:55
- **06-16 Tue** | #fitness 胸肩
- **06-17 Wed**
- **06-18 Thu** | #fitness 背手臂
```

Content Tab 显示：

```text
06-15 Mon  #zhongshan 06-15~06-27；#flight 上海虹桥 → 珠海 21:35-23:55
06-16 Tue  #fitness 胸肩
06-18 Thu  #fitness 背手臂
```

要求：

* 不显示空日期
* 按日期升序
* 点击 item 跳转到对应日期行
* 光标放到日期行末尾
* Content Tab 保留原始日期行显示

---

## 10. Upcoming Tab

Upcoming Tab 只显示未来事项和跨日期事件。

要求：

* 只显示今天之后的内容
* 正在进行中的跨日期事件也显示
* 已过期内容不显示
* 按日期升序
* 点击 item 跳转到对应日期行末尾
* 跨日期延续日也跳转到 range 开始日期

---

## 11. 跨日期事件

### 11.1 跨日期记录方式

跨日期事件只在开始日期写一次。

```md
- **06-15 Mon** | #zhongshan 06-15~06-27
```

不要每天重复写：

```md
- **06-15 Mon** | #zhongshan
- **06-16 Tue** | #zhongshan
- **06-17 Wed** | #zhongshan
```

---

### 11.2 跨日期 + 飞行

```md
- **06-15 Mon** | #zhongshan 06-15~06-27；#flight 上海虹桥 → 珠海 21:35-23:55
- **06-27 Sat** | #flight 珠海 → 上海浦东 14:45-17:15
```

含义：

* `#zhongshan 06-15~06-27` 是跨日期停留
* `#flight` 是当天飞行事件
* 去程和返程分别按当天记录

---

### 11.3 Live / 电音节 / 演唱会

单日：

```md
- **07-12 Sat** | #live [[周杰伦演唱会]]
```

多日：

```md
- **12-18 Fri** | #live [[泰e电音节]] 12-18~12-20
```

标签负责分类：

```md
#live
```

双链负责具体事件：

```md
[[泰e电音节]]
```

---

## 12. 跨日期范围格式

推荐格式：

```text
06-15~06-27
```

兼容格式：

```text
6.15~6.27
2026-06-15~2026-06-27
```

内部统一 normalize 成：

```text
2026-06-15 ~ 2026-06-27
```

---

## 13. Range Event 数据结构

```ts
type CalendarRange = {
  startDate: string;     // YYYY-MM-DD
  endDate: string;       // YYYY-MM-DD
  sourceDate: string;    // 写在哪一天
  text: string;
  tags: string[];
  links: string[];
};
```

示例：

```md
- **06-15 Mon** | #zhongshan 06-15~06-27
```

解析为：

```ts
{
  startDate: "2026-06-15",
  endDate: "2026-06-27",
  sourceDate: "2026-06-15",
  text: "#zhongshan 06-15~06-27",
  tags: ["zhongshan"],
  links: []
}
```

---

## 14. Upcoming 跨日期显示方式

跨日期事件在 Upcoming 中展开显示。

原始内容：

```md
- **11-05 Thu** | #travel Kuala Lumpur 11-05~11-08；#live The Weeknd
```

Upcoming 显示：

```text
2026-11

11-05 Thu  #travel Kuala Lumpur；#live The Weeknd
11-06 Fri  ↳
11-07 Sat  ↳
11-08 Sun  ↳
```

要求：

* 跨日期事件只统计为一个 event
* 视觉上展开显示覆盖的每一天
* 第一行显示完整内容，但去掉 range 文本本身
* 后续日期只显示日期 + `↳`
* 不重复显示原始 day item 和 range item
* 点击第一行或任意延续日期，都跳转到 range 开始日期行末尾

---

## 15. Upcoming 去重规则

不要显示成：

```text
11-05 Thu | #travel Kuala Lumpur 11-05~11-08；#live The Weeknd
11-05~11-08 11-05~11-08
```

正确逻辑：

* 如果某条内容包含日期范围
* Upcoming 只显示一个展开事件
* 不额外显示原始 day item
* 不额外显示 range item
* 不重复显示 range 文本

---

## 16. V2 Sidebar 最终结构

```text
Content | Upcoming
```

保留：

* Refresh 按钮
* Content Tab
* Upcoming Tab

移除：

* Calendar Tab
* Nav Tab
* Outline Tab
* Year / Month / Week / Day 导航按钮

---

# V3：Stats 统计视图

## 17. V3 目标

新增 `Stats` Tab，用于年度统计和回顾。

Sidebar 结构变为：

```text
Content | Upcoming | Stats
```

V3 只读取 `Calendar.md`，不修改内容。

---

## 18. Stats 统计内容

### 18.1 Fitness 统计

统计 `#fitness` 出现次数。

规则：

* 每出现一次算一次
* 按月份分组
* 显示年度总数

示例：

```text
Fitness

Jan  9 次
Feb  8 次
Mar  6 次

Total 23 次
```

---

### 18.2 Live 统计

统计 `#live` 事件。

规则：

* 如果有双链，按双链去重
* 如果是跨日期事件，只算一次
* 如果没有双链，按文本去重

示例：

```text
Live

11-05  The Weeknd
12-18~12-20  泰e电音节

Total 2 场
```

---

### 18.3 Flight 统计

统计 `#flight` 出现次数。

规则：

* 每出现一次算一段飞行
* 去程和返程分别算
* 不按日期范围展开

示例：

```text
Flight

06-15  上海虹桥 → 珠海
06-27  珠海 → 上海浦东

Total 2 段
```

---

### 18.4 Travel / Place 统计

统计旅行和地点类事件。

示例标签：

```md
#travel
#shanghai
#zhongshan
#bangkok
#kuala-lumpur
```

规则：

* `#travel` 作为出游类标签
* 地点标签作为地点统计
* 跨日期事件只算一次
* 支持显示日期范围

示例：

```text
Travel / Places

06-15~06-27  Zhongshan
11-05~11-08  Kuala Lumpur

Total 2 次
```

---

### 18.5 Monthly Summary

按月份汇总核心标签。

示例：

```text
2026-01
#fitness  9
#live     0
#flight   0

2026-02
#fitness  8
#live     1
#flight   2
```

---

## 19. Stats 点击跳转

Stats 中的 item 可以点击。

要求：

* 点击普通日期 item，跳转到对应日期行末尾
* 点击跨日期 item，跳转到 range 开始日期行末尾
* 不改变 `Calendar.md` 内容

---

# V4：Heatmap / 可视化

## 20. V4 目标

增加热力图和简单可视化，用于查看行为分布。

V4 不改变 `Calendar.md` 存储格式，只基于 parser 数据渲染。

---

## 21. Heatmap 功能

### 21.1 Fitness Heatmap

显示 `#fitness` 年度分布。

规则：

* 每天有 `#fitness` 则当天点亮
* 同一天多次可显示更深状态
* 支持按年份查看

---

### 21.2 Live Timeline

显示 `#live` 时间分布。

规则：

* 单日 live 显示为单点
* 跨日期 live 显示为连续范围
* 按月份分组

---

### 21.3 Flight Distribution

显示 `#flight` 分布。

规则：

* 每个 `#flight` 算一次
* 可按月份显示飞行次数
* 可显示总次数

---

### 21.4 Travel Range View

显示跨日期旅行 / 停留。

示例：

```text
06-15~06-27  Zhongshan
11-05~11-08  Kuala Lumpur
12-18~12-20  Phuket
```

---

## 22. V4 暂不做

V4 暂不做复杂图表库接入。

不做：

* ECharts
* D3
* 复杂交互图表
* 拖拽调整日期
* 自动生成图片报告

优先用轻量 DOM / CSS 实现。

---

# V5：Year Review / 年度回顾

## 23. V5 目标

基于全年数据生成年度回顾。

用途：

* 快速回看一年做了什么
* 总结健身、旅行、live、飞行
* 生成可复制的年度总结 Markdown

---

## 24. Year Review 内容

示例：

```text
2026 Year Review

Fitness
今年健身 86 次，最多的是 6 月，共 12 次。

Live
今年去了 4 场 live：
- The Weeknd
- 泰e电音节
- 周杰伦演唱会

Travel
今年去了 5 个地方：
- Zhongshan
- Shanghai
- Kuala Lumpur
- Bangkok
- Phuket

Flight
今年飞了 12 段。

Longest Trip
最长一次跨日期事件：
06-15~06-27 Zhongshan，共 13 天。
```

---

## 25. Year Review 输出方式

支持生成 Markdown。

命令：

```text
Generate Year Review
```

输出到：

```md
Year Review 2026.md
```

或者复制到剪贴板。

---

# 26. 标签体系

## 26.1 推荐标签

```md
#fitness
#live
#flight
#travel
#shanghai
#zhongshan
#bangkok
#kuala-lumpur
#phuket
```

---

## 26.2 标签分工

行为类标签：

```md
#fitness
#live
#flight
#travel
```

地点类标签：

```md
#shanghai
#zhongshan
#bangkok
#kuala-lumpur
#phuket
```

---

## 26.3 标签与双链

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

不推荐只写：

```md
- **12-18 Fri** | #live 泰e
```

如果以后要统计“去了哪些 live”，双链更容易去重。

---

# 27. 点击跳转规则

所有 Sidebar item 点击后：

普通日期：

```text
跳转到该日期行末尾
```

跨日期事件：

```text
无论点击开始日还是延续日，都跳转到 range 开始日期行末尾
```

原因：

* 用户点击后通常是为了查看或继续编辑
* 光标放在行末最方便继续输入

---

# 28. 不做内容

V1 ~ V5 暂不做：

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
* 复杂图表库

---

# 29. 最终示例

```md
# Calendar

## 2026

### Jun

- **06-13 Sat**
- **06-14 Sun**
- **06-15 Mon** | #zhongshan 06-15~06-27；#flight 上海虹桥 → 珠海 21:35-23:55
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

### Nov

- **11-05 Thu** | #travel Kuala Lumpur 11-05~11-08；#live [[The Weeknd]]
- **11-06 Fri**
- **11-07 Sat**
- **11-08 Sun**

### Dec

- **12-18 Fri** | #live [[泰e电音节]] 12-18~12-20
- **12-19 Sat**
- **12-20 Sun**
```

---

# 30. 开发顺序

## Phase 1：稳定 V1

* Generate Calendar
* Append Year
* Jump to Today
* Jump to Date
* Add Item to Date
* Parser
* inline 内容格式
* 日期输入 normalize

---

## Phase 2：稳定 V2

* Content Tab
* Upcoming Tab
* 跨日期事件解析
* Upcoming 跨日期展开显示
* 跨日期去重
* Sidebar 只保留 Content / Upcoming
* 点击跳转到日期行末尾

---

## Phase 3：实现 V3

* Stats Tab
* Fitness 统计
* Live 统计
* Flight 统计
* Travel / Place 统计
* Monthly Summary
* Stats item 点击跳转

---

## Phase 4：实现 V4

* Fitness Heatmap
* Live Timeline
* Flight Distribution
* Travel Range View

---

## Phase 5：实现 V5

* Year Review
* Generate Year Review 命令
* 输出年度总结 Markdown
* 支持复制到剪贴板
