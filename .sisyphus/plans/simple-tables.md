# 纯HTML表格展示页面

## TL;DR

> **Quick Summary**: 创建一个纯HTML文件，包含简洁现代风格的静态表格，使用示例/演示数据展示。
>
> **Deliverables**: 
> - 一个独立的 `tables.html` 文件（内联CSS，零依赖）
>
> **Estimated Effort**: Quick
> **Parallel Execution**: YES - 单任务
> **Critical Path**: Task 1

---

## Context

### Original Request
设计一个纯HTML，用来展示一些简单表格。

### Interview Summary
**Key Discussions**:
- 数据类型: 示例/演示数据（模拟数据）
- 样式偏好: 简洁现代（干净线条、柔和颜色、现代感）
- 功能需求: 纯展示（无交互功能）

### Metis Review
N/A - 需求简单明确，无需额外咨询。

---

## Work Objectives

### Core Objective
创建一个纯HTML页面，展示美观的现代风格表格，使用示例数据。

### Concrete Deliverables
- `tables.html` — 独立HTML文件，内联CSS，包含2-3个示例表格

### Definition of Done
- [ ] `tables.html` 可在浏览器中直接打开并正常显示
- [ ] 表格样式简洁现代，无需外部依赖

### Must Have
- 纯HTML + 内联CSS（零外部依赖）
- 至少2个不同样式的表格示例
- 响应式设计（移动端友好）
- 现代配色（柔和背景色、圆角、阴影）

### Must NOT Have (Guardrails)
- 不使用任何CSS框架（Bootstrap、Tailwind等）
- 不使用JavaScript交互
- 不引入外部字体或资源（纯系统字体）

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None
- **Framework**: none
- **Agent-Executed QA**: Playwright 打开HTML文件验证渲染

### QA Policy
- 使用 Playwright 打开HTML文件，截图验证表格渲染效果

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Single Task):
└── Task 1: 创建 tables.html 页面 [quick]
```

### Dependency Matrix
- **1**: — — None

### Agent Dispatch Summary
- **1**: **1** — T1 → `quick`

---

## TODOs

- [ ] 1. 创建 tables.html 表格展示页面

  **What to do**:
  - 创建 `tables.html` 文件（UTF-8编码）
  - 使用 `<style>` 内联CSS，零外部依赖
  - 设计3个不同场景的表格：
    1. **基础数据表** — 用户信息表（姓名、邮箱、角色、状态）
    2. **数值统计表** — 月度数据（月份、收入、支出、利润）
    3. **状态标签表** — 任务列表（任务名、负责人、优先级、进度条）
  - 表格样式要求：
    - 圆角边框（border-radius: 8px）
    - 柔和阴影（box-shadow）
    - 斑马纹行（alternate row colors）
    - hover行高亮效果（:hover）
    - 表头背景色（柔和的蓝色/灰色）
    - 使用系统字体栈（-apple-system, BlinkMacSystemFont, "Segoe UI"）
    - 表格间距合理，每个表格有标题
  - 响应式：小屏幕时表格可水平滚动

  **Must NOT do**:
  - 不使用任何外部CSS/JS库
  - 不添加JavaScript交互逻辑
  - 不使用外部字体文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件HTML+CSS，范围小、需求明确
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 任务简单，不需要完整设计系统

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - 无外部参考 — 纯HTML/CSS基础实现

  **Acceptance Criteria**:
  - [ ] `tables.html` 文件存在且可被浏览器打开
  - [ ] 页面包含至少2个表格
  - [ ] 表格有圆角、阴影、斑马纹等现代样式
  - [ ] 页面无JavaScript错误（纯静态）

  **QA Scenarios**:

  ```
  Scenario: 页面正常渲染
    Tool: Playwright
    Preconditions: tables.html 文件存在于项目根目录
    Steps:
      1. 使用 page.goto() 加载 file:// 路径的 tables.html
      2. 等待页面加载完成 (page.waitForLoadState('networkidle'))
      3. 检查页面包含至少2个 <table> 元素 (page.locator('table'))
      4. 检查表格有表头 (page.locator('thead, th'))
      5. 截图保存验证样式
    Expected Result: 页面加载成功，至少2个表格正确渲染，样式现代简洁
    Failure Indicators: 表格无样式、元素未找到、页面空白
    Evidence: .sisyphus/evidence/task-1-page-render.png

  Scenario: 表格样式验证
    Tool: Playwright
    Preconditions: tables.html 已加载
    Steps:
      1. 获取第一个表格的样式 (page.locator('table').first())
      2. 检查 border-radius 属性存在
      3. 检查 box-shadow 属性存在
      4. 检查表格行数 > 1 (斑马纹需要多行)
    Expected Result: 表格具有圆角和阴影样式，包含多行数据
    Failure Indicators: 无圆角、无阴影、只有一行数据
    Evidence: .sisyphus/evidence/task-1-style-check.png
  ```

  **Evidence to Capture:**
  - [ ] 页面整体截图
  - [ ] 表格样式细节截图

  **Commit**: YES
  - Message: `feat(ui): add pure HTML table display page`
  - Files: `tables.html`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Verify: tables.html exists, contains ≥2 tables, has inline CSS, zero external dependencies.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Review tables.html for: valid HTML5, no JS errors, clean CSS, proper semantics.
  Output: `HTML Valid [PASS/FAIL] | CSS Clean [PASS/FAIL] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Open tables.html in browser, verify all 3 tables render correctly with modern styling.
  Output: `Tables [N/N render correctly] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Verify: only tables.html created, no extra files, no JS frameworks, no external deps.
  Output: `Files [1 expected, 1 found] | Scope [CLEAN] | VERDICT`

---

## Commit Strategy

- **1**: `feat(ui): add pure HTML table display page` — tables.html

---

## Success Criteria

### Verification Commands
```bash
# Open in browser and verify visually
start tables.html  # Windows
```

### Final Checklist
- [ ] tables.html 存在且可独立打开
- [ ] 包含至少2个表格
- [ ] 纯HTML+内联CSS，零外部依赖
- [ ] 样式简洁现代（圆角、阴影、斑马纹）
- [ ] 无JavaScript代码
