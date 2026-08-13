# Design QA｜茸光管理端方向 1

## 对比目标

- source visual truth path: `design-reference/mg-01-option-1.png`
- implementation screenshot path: `design-qa/implementation-workbench-1440-final.png`
- full-view comparison evidence: `design-qa/workbench-comparison-final.png`
- focused region comparison evidence: `design-qa/workbench-focus-comparison-final.png`
- responsive evidence: `design-qa/implementation-staff-mobile-final.png`
- state: 店长身份，MG-01 今日工作台，2026年8月13日 周四 10:50；员工证据为 ST-02 我的今日工作。

## 规格与归一化

- 源图：1487 × 1058 px，按 LANCZOS 归一化为 1440 × 1024 px 后比较。
- 桌面实现：浏览器 CSS viewport 1440 × 1024，deviceScaleFactor 1，截图 1440 × 1024 px。
- 员工移动实现：浏览器 CSS viewport 390 × 844，deviceScaleFactor 1；页面内容宽度 375 px，`scrollWidth` 与 `clientWidth` 均为 375 px，无横向溢出。
- 对比中不包含浏览器导航栏或外部设备框。

## Findings

最终复核未发现可执行的 P0、P1 或 P2 差异。

- 字体与排版：使用 PingFang SC / Microsoft YaHei / 系统无衬线栈；标题、正文、时刻、数字和辅助信息层级与源稿一致。时刻与看板数字使用等宽数字特性，没有明显截断或异常换行。
- 间距与布局：固定窄侧栏、风险队列、状态摘要和员工日时间线保持源稿主比例；首屏内容填充完整，页面没有水平溢出或遮挡。卡片圆角、描边和轻量层级与方向 1 一致。
- 色彩与 token：奶油色、鼠尾草绿、珊瑚警示、信息蓝和危险红映射到独立语义；状态和行动提醒使用不同组件语法，不只依赖颜色。
- 图片质量：宠物、员工和品牌照片全部使用真实栅格资产，裁切清晰、光线和背景统一；没有用 CSS 图形、手绘 SVG、emoji 或占位块替代目标资产。
- 文案与内容：方向 1 中的三项风险、六类预约状态、四名员工、时间与样例预约保持一致；新增页面遵循 PRD 领域语言，没有引入支付、多门店、会员或营收等范围外概念。
- 图标与控件：使用同一套 Radix 线性图标；操作、状态和导航图标尺寸及描边一致，焦点样式清晰。
- 交互状态：抽屉、弹窗、选中、禁用、字段错误、成功 toast、危险二次确认和空筛选状态均有对应实现。
- 响应式与无障碍：390 px 员工工作台主要触控目标不小于 44 px；表单标签始终可见，按钮和输入可键盘聚焦，核心图片具有替代文字。

## 对比历史

### 第 1 次比较｜blocked

- [P2] 时间线纵向密度偏紧：实现的四条员工泳道高度为 82 px，导致首屏底部出现明显空白，低于源稿的工作区占比。
- [P2] 日期上下文重复占行：实现先在主内容中单独显示日期，压缩了风险区和时间线的垂直空间。
- [P2] 预约块识别度不足：首版只显示宠物名称，源稿在关键预约块中使用宠物图像帮助快速识别。

修复：员工泳道提升为 124 px；日期移入顶部上下文栏并移除主内容独立行；关键预约块加入统一裁切的宠物缩略图。

### 第 2 次比较｜passed

后续全视图与顶部聚焦对比确认：风险区比例、状态摘要、日时间线高度、宠物识别资产与首屏节奏均已对齐；未遗留 P0/P1/P2。

## 浏览器验证

- 巡检店长导航：工作台、预约、排班、服务、顾客、经营、系统均可进入对应页面。
- 验证核心路径：预约详情 → 店长改期；待处理停班 → 两笔受影响预约逐笔处理 → 正式生效；员工六位码核销；迟到填写原因后手动核销；完成服务并保存门店服务记录；登录页角色选择与恢复。
- 桌面工作台 1440 × 1024 无横向溢出；员工端 390 × 844 无横向溢出。
- 浏览器 console warnings/errors: 0。
- `npm run build`: passed。
- `npm run test:sites`: 4 passed。

## Implementation Checklist

- [x] 方向 1 首屏视觉和品牌资产落地。
- [x] 店长七个导航区与关键异常流程可交互。
- [x] 员工移动工作台与履约路径可交互。
- [x] 桌面和 390 px 响应式验证。
- [x] 浏览器交互、控制台、构建和 Sites 契约验证。

## Follow-up Polish

- [P3] 源稿日历背景包含更密集的 15 分钟竖向辅助线；实现保留了时间刻度、周转图例和状态纹理，但弱化了背景网格，以降低视觉噪声。当前不影响排班关系判断。

final result: passed
