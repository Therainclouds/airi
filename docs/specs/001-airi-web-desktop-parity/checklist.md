---
title: AIRI Web/Desktop 功能一致性检查清单
description: 供方案评审、实施前后自查与发布前回归使用。
---

# 架构检查

- [x] 已明确 Shared Core、Runtime Adapters、Shell Apps 三层边界
- [x] 已明确 Web/Desktop 功能一致性的三档标准
- [ ] 已明确哪些能力必须保留为桌面专属
- [x] 已明确共享层禁止直接依赖 Electron
- [ ] 已明确 capability contract 的 owner 与注入方式

# 目录归属检查

- [ ] `packages/stage-ui` 仅保留共享业务与交互核心
- [ ] `packages/stage-layouts` 仅保留跨端共享布局与舞台容器
- [ ] `packages/stage-pages` 承担共享页面主体
- [ ] `packages/stage-shared` 承担环境基础与能力契约，不承载壳层业务
- [ ] `apps/stage-web` 只保留 Web 壳层逻辑
- [ ] `apps/stage-tamagotchi` 只保留 Desktop 壳层逻辑

# 启动流程检查

- [ ] Web 与 Desktop 已收口到统一 bootstrap 思路
- [ ] Web 与 Desktop 的重复初始化项已识别并建立迁移计划
- [ ] runtime provider 的注入点清晰
- [ ] capability availability 能在两个端一致读取

# 页面一致性检查

- [x] 设置页主体已优先回收到 `stage-pages`
- [部分完成] Web 与 Desktop 的重复设置页主体已开始清理，仍有部分壳层增强页待继续收口
- [ ] 桌面特有页面与共享页面有清晰边界
- [ ] 共享页面中不出现 Electron-only 直接调用
- [x] 已建立共享 routes registry 作为统一装配入口

# 能力一致性检查

- [ ] 聊天能力在 Web/Desktop 语义一致
- [ ] 角色设定与 provider 配置在 Web/Desktop 语义一致
- [ ] 多模态能力在 Web/Desktop 至少做到降级一致
- [ ] 文件、截图、插件等能力的降级语义已定义
- [ ] 桌宠能力仍明确归属 Desktop 壳层

# 桌宠专项检查

- [ ] 悬浮窗能力不泄漏进共享层
- [ ] 点击穿透与鼠标交互只由 Desktop 壳层控制
- [ ] 托盘、多窗口、快捷键只由 Desktop 壳层控制
- [ ] 桌宠增强能力具备对 Shared Core 的稳定输入接口

# 文档与治理检查

- [x] 已补充本规格对应的实施任务清单
- [ ] 已建立后续跨端 smoke 与回归检查入口
- [ ] 已定义新增功能先进入 Shared Core 的准入规范
- [ ] 已计划修正文档中桌面端过期描述
