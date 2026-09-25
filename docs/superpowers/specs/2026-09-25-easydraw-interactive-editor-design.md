# easydraw 交互式波形编辑器 — 设计文档

- 日期：2026-09-25
- 状态：待评审
- 决策来源：与作者的问答（交付形态 / v1 范围 / 文本面板方向 / 技术路线均已确认）

## 1. 背景与目标

WaveDrom 引擎是单向的：WaveJSON 文本 → SVG 图。作者要一个能"画"的编辑器：在波形区域用鼠标点选工具、点击格子，直接画出时序图，同时不改动引擎的任何现有功能（CLI、npm 库 API、`processAll` 网页嵌入）。

成功标准：

1. 只用鼠标能从空白画出一张多信号时序图（含时钟、总线数据）。
2. 粘贴已有 WaveJSON，画布实时呈现，可继续用鼠标修改。
3. 能导出 SVG、PNG、.json5 文件；刷新页面不丢内容。
4. 撤销/重做可用。
5. 现有 `npm test` 全部通过，CLI 与库 API 行为零变化。

## 2. 已确认的决策

| 决策点 | 结论 |
|---|---|
| 交付形态 | 仓库内置网页编辑器（`editor/` 目录 + 打包产物） |
| v1 范围 | 波形绘制 + 总线数据编辑 + 信号行管理 + 版面/皮肤配置，四项全做 |
| 文本面板 | 双向同步（文本可编辑，画布实时互刷） |
| 技术路线 | 方案 A：命中网格覆盖层 + 全量重渲染，引擎零改动 |

## 3. 架构

三层，自上而下依赖：

```
交互层（新）  工具栏 · 命中网格覆盖层 · 文本面板 · 属性面板 · 撤销栈
模型层（新）  唯一数据源 = WaveJSON JS 对象；所有编辑是原子操作 op
渲染层（现有） renderAny(0, source, skins) → SVG → 替换进 DOM
```

数据流：每个 op 执行「改模型 → 全量重渲染 → 刷新命中网格 → 序列化刷新文本 → 自动保存」。全量重画幂等，没有增量状态可漂移。上游编辑器本身就是每键击全量重渲染，编辑器规模下性能足够。

撤销/重做：op 执行前深拷贝模型压栈，上限 100 步，redo 栈对称。

## 4. 组件与文件布局

```
editor/
  easydraw.html    页面：顶部工具栏 / 中间画布 / 底部文本面板 + 属性面板
  easydraw.css
lib/easydraw/
  model.js     纯逻辑：setCycle、addSignal、removeSignal、renameSignal、
               moveSignal、resizeCycles、setBusData、serialize（无 DOM，可单测）
  geometry.js  渲染后从 lane 状态与 SVG 实测计算 (x,y) → (行, 周期)
  interact.js  pointer 事件、工具应用、拖拽绘制、行选中、行内编辑
  textsync.js  文本面板双向同步：防抖、json5 解析、语义校验
  editor.js    入口：组装以上模块，页面加载后启动
```

构建：新增 `npm run editor`（esbuild 打包 `lib/easydraw/editor.js` → `editor/wavedrom.editor.js`）与 `npm run watch.editor`。页面按 test.html 的方式引 `../skins/*.js` 与打包产物。现有 `dist`/`prepare`/CI 脚本不改。

## 5. 交互规格

**画波形**：工具面板提供 `0 1 x z . | p n P N` 与「总线」工具。hover 时高亮目标格子；click 应用工具；按住拖拽连续绘制（pointer capture）。`.` 工具写入延续符。

**信号行管理**：点击信号名选中行，工具条提供重命名（行内编辑）、删除、上移/下移、在下方插入信号行、插入空行分隔（`{}`）。

**总线**：「总线」工具点击格子 → 从该格起写 `=` 并弹出输入框 → 输入内容进入 `data` 数组。已有总线段点击可改值。

**周期数**：+/- 按钮统一增减所有 wave 长度（见 §6）。

**版面**：属性面板切换皮肤（default/narrow/dark/lowkey/narrowerer/narrower，页面全部载入）、编辑 `head`/`foot` 文本。

**边界**：文档为 `assign` 或 `reg` 图时，画布仅渲染、不可交互；文本面板可编辑。提示「画布编辑仅支持 signal 图」。

## 6. wave 字符编辑语义（model.js 核心规则）

- `setCycle(row, i, ch)`：`i` 超出当前长度时先以 `.` 补齐再写入；`|` 占一个字符位，其后的周期照常按字符下标编辑。
- `resizeCycles(n)`：`n` = 所有 wave 长度的目标值。增大：各 wave 尾部 pad `.`；减小：截断。被截断的数据砖对应 `data` 项一并移除。
- 总周期数 = 所有 wave 长度的最大值（与引擎的派生规则一致）。
- **data 对齐规则必须以 `gen-brick.js` 的砖块生成逻辑为准实现**：`data` 数组按顺序被"数据砖"消费，数据砖由 `=` 或数字字符开始、被 `.` 延续构成。实现时不凭记忆写规则，用引擎渲染输出做对照测试锁定（见 §11）。v1 的总线工具只写 `=` + `data`，不写数字短砖。

## 7. 文本面板双向同步协议

- 画布 → 文本：每次 op 后 `JSON.stringify(model, null, 2)`（保留键序），替换面板内容，保持滚动位置。
- 文本 → 画布：输入防抖 300ms → `json5.parse` → 语义校验（根为对象；`signal` 为数组；允许 `assign`/`reg` 进入只读态，见 §5）→ 合法则替换模型并重渲染；非法则面板标红显示错误行信息，画布保持最近合法状态。
- 文本面板有焦点且内容非法时，禁用画布编辑操作（防止覆盖正在输入的内容）。

## 8. 几何与命中检测

- 渲染后从 `lib/lane.js` 模块单例读取几何（`xs`/`xg`/`xmax` 等，渲染流程写入）；周期 → 像素的具体映射以 `render-wave-lane.js` 的实现为准，`geometry.js` 用单测锁定。
- 兜底校准：从渲染产物 SVG 取首个 lane 图元的实际坐标，与计算值比对，偏差超过 1px 时以实测为准（防皮肤差异）。
- 命中层：绝对定位的透明覆盖 div，监听 pointerdown/move/up，将坐标换算为（行，周期）；hover 高亮用 CSS，不触碰引擎 SVG 内部。

## 9. 导出与持久化

- SVG：序列化 `svgcontent_0`，做法参考现有 `append-save-as-dialog.js`。
- PNG：canvas 栅格化，同上参考。
- .json5：下载当前序列化文本。
- localStorage：key `easydraw.doc`，op 后防抖 1s 自动保存，启动时恢复；「新建」按钮清空并回到初始样例图。

## 10. 错误处理

- 文本面板语法/语义错误：行内提示，不中断画布。
- 模型操作越界（删除最后一行、周期减到 0）：按钮禁用或提示。
- 引擎渲染异常：沿用 `eva`/`erra` 现有兜底（错误信息画进图里）。

## 11. 测试策略

- `model.js`、`textsync.js`、`geometry.js` 为纯逻辑，全量单测（mocha + chai + c8，仓库现有栈），并入 `npm test`。
- wave 语义必测用例：`=`+`.` 连续段消费单个 data 项；`|` 前后数据砖边界；截断周期后 data 清理；`p`/`n`/`P`/`N` 时钟字符写入；越界写入补 `.`；序列化 round-trip（parse(stringify(m)) 语义等价）。
- data 对齐对照测试：对一组样例，用引擎渲染实际产物校验 model.js 的砖块计数与引擎一致。
- UI 层 v1 手动验收，smoke 清单（新建/画/改/撤销/粘贴 JSON/切皮肤/导出四件套/刷新恢复）随实现提交到 `docs/`。

## 12. 构建与兼容性承诺

- `npm run editor` 独立产物，不进 `files` 发布清单（除非后续决定随包发布编辑器）。
- `lib/` 现有文件零修改（easydraw 仅新增文件、只读引用 `lane.js`）；`bin/cli.js`、`process-all.js`、现有测试零改动。
- 现有使用方（CLI、npm 库、网页嵌入）无任何行为变化。

## 13. v1 范围外

弧线箭头（arcs/edge）、分组（groups）、`assign`/`reg` 的画布编辑、多图同页、多人协作、移动端专项适配、增量 DOM 渲染（方案 B 留作日后性能优化，接口不变）。
