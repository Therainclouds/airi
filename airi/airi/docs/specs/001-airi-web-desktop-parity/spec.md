---
title: AIRI Web/Desktop 功能一致性与桌宠壳层边界
description: 定义 AIRI 页面端与桌面端的共享核心、壳层边界、能力注入方式与阶段性落地路线。
---

# Summary

本规格定义 AIRI 后续演进的统一方向：

- AIRI 作为未来统一前端承载体
- Web 与 Desktop 共享同一套业务核心、页面主体与状态编排
- 桌宠能力保留为 Desktop 壳层专属增强
- 共享层只依赖能力契约，不直接依赖 Electron 或 Web 壳层实现

# Background

当前仓库已经具备共享层基础：

- `packages/stage-ui` 承担主要业务状态与交互编排
- `packages/stage-layouts` 承担共享布局与舞台容器
- `packages/stage-pages` 承担部分共享页面
- `packages/stage-shared` 提供环境判断与跨端基础能力

但当前仍存在以下问题：

- Web 与 Desktop 入口初始化存在重复与分叉
- 共享层中仍有运行时分支判断，平台边界不够清晰
- 页面共享策略不彻底，存在 app 级页面重复与例外排除
- 桌面专属能力尚未沉淀为统一 capability contract

这些问题会直接影响后续目标：

- 页面端与桌面端功能一致
- 桌宠能力继续由 Desktop 承载
- 未来可以在不绑定 LobsterAI 的前提下，继续扩展 AIRI 作为多功能前端

# Goals

- 建立 AIRI 的共享核心与壳层边界
- 明确 Web 与 Desktop 的一致性分层标准
- 统一启动流程、共享页面装配与能力注入方式
- 为后续桌宠增强提供稳定的 Desktop 宿主边界
- 为未来接入更多后端能力保留前端统一承载结构

# Non-goals

- 本阶段不合并 AIRI 与 LobsterAI 仓库
- 本阶段不追求单安装包或单 exe
- 本阶段不重写桌宠窗口系统
- 本阶段不消灭所有 Web/Desktop 差异
- 本阶段不改造移动端或 `stage-pocket`

# Proposal

## 分层模型

后续 AIRI 统一采用三层结构：

- Shared Core
  - `packages/stage-ui`
  - `packages/stage-layouts`
  - `packages/stage-pages`
  - `packages/stage-shared`
- Runtime Adapters
  - Web runtime adapter
  - Electron renderer adapter
  - Electron main/preload adapter
- Shell Apps
  - `apps/stage-web`
  - `apps/stage-tamagotchi`

## 一致性标准

功能一致性分三档定义：

- 完全一致
  - 聊天
  - 角色设定
  - provider / bridge
  - 多模态输入
  - 设置项主体
  - 共享页面主体
- 降级一致
  - 文件能力
  - 语音输入
  - 截图 / 上下文桥接
  - 插件能力的非系统级部分
- 桌面专属
  - 桌宠悬浮窗
  - 托盘
  - 点击穿透
  - 多窗口
  - 全局快捷键
  - 本地插件宿主
  - 系统级权限与资源访问

## 边界原则

- 共享层不直接调用 `window.electron`
- 共享层不通过 `isStageTamagotchi()` 决定业务行为
- 共享层只通过 capability contract 查询能力是否存在
- 桌面专属能力由 Desktop 壳层注册并注入
- Web 必须为不可用能力提供 no-op 或降级语义

# Design Details

## Shared Core 职责

- 业务 store
- 聊天与多模态编排
- 角色、记忆、provider、settings 逻辑
- 共享页面与共享布局
- 舞台主体组件
- 桌宠 UI 中可跨端复用的表现层

## Runtime Capability Contract

后续统一抽象以下能力接口：

- WindowCapability
- MediaCapability
- ScreenCaptureCapability
- PluginCapability
- SystemCapability
- PersistenceCapability
- UpdateCapability

共享层只知道：

- 这个能力是否可用
- 调用后返回什么语义
- 不可用时如何降级

## Bootstrap 统一

新增统一的 Stage Bootstrap 目标：

- 创建 app
- 注册 pinia、i18n、router、layouts
- 初始化 chat / settings / character / display model
- 初始化 shared pages 与 runtime bridge
- 统一埋点、错误处理与 capability availability

Web 与 Desktop 的差异应保留在壳层 bootstrap 中，而不是散落在共享业务代码中。

## 路由与页面统一

后续采用：

- `stage-pages` 提供默认共享页面
- `stage-web` / `stage-tamagotchi` 只做壳层覆写或附加元数据
- 避免继续维护两套语义相同但入口不同的页面实现

## 桌宠壳层定位

Desktop 作为桌宠宿主，负责：

- 透明窗、悬浮窗、点击穿透
- 托盘、窗口管理、全局交互
- 本地权限与系统资源访问
- 插件宿主与本地 runtime

这些能力必须留在 Desktop 壳层，不能反向污染 Shared Core。

# Verify & Test

完成后必须验证：

- 同一功能在 Web/Desktop 的设置项与交互语义一致
- 共享页面只保留一份主体实现
- 共享层不再出现新的 Electron 直接依赖
- 桌面能力在 Web 上有明确降级行为
- 桌宠相关窗口能力仍只存在于 Desktop 壳层

# Milestones

## M1 边界冻结

- 定义 capability matrix
- 冻结 shared / shell 目录归属
- 冻结一致性分档标准

## M2 启动统一

- 抽离统一 bootstrap
- 抽离 runtime provider 注入模型

## M3 页面统一

- 将设置页与核心共享页面迁入共享层
- 收口 route composition

## M4 能力统一

- 用 capability contract 替换共享层环境分支
- 建立跨端 smoke 与一致性检查

# Success Metrics

- 共享层中的平台专属调用显著减少
- Web/Desktop 页面主体复用率提升
- 新功能默认先落在 Shared Core
- 桌面端继续稳定承载桌宠能力
- 后续新增接入能力不再要求复制两套页面逻辑
