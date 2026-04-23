---
title: AIRI Web/Desktop 功能一致性执行任务
description: 将共享核心、能力边界与桌宠壳层收口为可执行开发任务。
---

# P0 架构冻结

- [ ] T001 建立 Web/Desktop capability matrix，明确完全一致、降级一致、桌面专属三档
- [ ] T002 盘点 `stage-ui`、`stage-layouts`、`stage-pages`、`stage-shared` 的目录归属与越界点
- [ ] T003 盘点 `apps/stage-web` 与 `apps/stage-tamagotchi` 的入口重复初始化项
- [ ] T004 盘点共享层中直接 Electron 依赖、环境分支与壳层耦合点
- [ ] T005 形成统一的 Shared Core / Runtime Adapters / Shell Apps 目录边界说明

# P1 启动统一

- [ ] T006 抽出 `createStageApp()` 统一 app、router、pinia、i18n、layouts 装配
- [ ] T007 抽出 `initializeStageCore()` 统一 chat、character、settings、context bridge、display model 初始化
- [ ] T008 为 Web 与 Desktop 定义 runtime provider 注入入口
- [ ] T009 收口 `stage-web` 与 `stage-tamagotchi` 的重复 bootstrap 逻辑
- [ ] T010 建立统一 capability availability 上报与错误入口

# P1 页面统一

- [ ] T011 盘点 Web/Desktop 当前页面差异，输出共享候选页、壳层增强页、桌面专属页清单
- [ ] T012 将设置页主体继续迁入 `stage-pages`
- [ ] T013 将首页舞台页面拆成共享主体与壳层增强部分
- [ ] T014 建立共享 routes registry，统一 shared pages 装配方式
- [ ] T015 消除当前通过排除或例外补丁维持的一致性分叉

# P2 能力统一

- [ ] T016 设计 `WindowCapability`
- [ ] T017 设计 `MediaCapability`
- [ ] T018 设计 `ScreenCaptureCapability`
- [ ] T019 设计 `PluginCapability`
- [ ] T020 设计 `SystemCapability`
- [ ] T021 为 Web 提供 no-op 或降级 adapter
- [ ] T022 将共享层中的平台判断迁移为 capability 查询
- [ ] T023 禁止共享层新增直接 `window.electron` 访问

# P2 桌宠壳层收口

- [ ] T024 明确桌宠窗口、托盘、点击穿透、多窗口与桌面特效的壳层 owner
- [ ] T025 明确桌宠专属交互对 Shared Core 的能力契约输入
- [ ] T026 确保桌宠增强不反向污染共享页面与共享 store
- [ ] T027 为桌宠能力定义 Web 不可用或降级语义

# P3 一致性治理

- [ ] T028 建立 Web/Desktop 功能一致性清单
- [ ] T029 建立跨端 smoke 流程：启动、聊天、设置、provider、舞台、桌宠入口
- [ ] T030 建立共享层越界检测规则
- [ ] T031 建立“新功能先 shared core，后 shell override”的准入规范
- [ ] T032 修正文档中仍把桌面端描述为 Tauri 的过期表述

# 验收标准

- [ ] A001 页面端与桌面端的共享页面主体有明确 owner
- [ ] A002 共享层不再扩散新的 Electron 专属调用
- [ ] A003 Web/Desktop 的核心聊天与角色能力语义一致
- [ ] A004 Desktop 仍完整承载桌宠能力
- [ ] A005 新增接入能力时无需复制两套页面主体实现
