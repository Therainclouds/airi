# AIRI与LobsterAI 动作打通与控制计划

## 1. 需求分析与方案概述
目标是让 LobsterAI（大模型）能够主动控制 AIRI 的动作展示，同时屏蔽现有的基于运行状态（如 `think`, `tool_use`）的自动动作编排，且保留原有的嘴部（口型同步）和眼睛（自动眨眼/视线跟随）动画。

目前的机制中，LobsterAI 的 `AgentApiServer` 会在状态变化时自动向 AIRI 发送 `<|ACT:...|>` Token，这属于“被动/固定的动作编排”。为了实现“通过大模型的能力来主动调用”，我们将：
1. **屏蔽自动编排**：在 LobsterAI 的通信层拦截掉自动下发的动作 Token。
2. **设置控制技能 (Skill)**：在 LobsterAI 中新增一个特定的 Skill，通过 Prompt 引导大模型根据聊天语境主动在生成的回复中输出 `<|ACT:{"emotion":{"name":"...","intensity":1}}...|>`。

## 2. 具体执行步骤

### [ ] 步骤 1: 屏蔽现有的自动动作编排
- **目标文件**: `g:\AIproject\TengleupTeamPorject\baby_claw\baby\LobsterAI\src\main\libs\agentApiServer.ts`
- **操作**: 注释或移除 `handleChat` 和 `handleChatNoStream` 等方法中自动调用的 `this.emitActTokenToStream(res, sessionId, '...')`。
- **效果**: 这样可以阻止根据系统状态（如进入 `tool_use` 或 `success` 时）自动播放固定的尴尬、开心等动作，将控制权完全移交给大模型本身。

### [ ] 步骤 2: 创建 LobsterAI 动作控制技能 (Skill)
- **目标文件**: `g:\AIproject\TengleupTeamPorject\baby_claw\baby\LobsterAI\SKILLs\airi-motion-control\SKILL.md`
- **操作**: 新建技能文档。
- **内容设计**:
  - 技能名称定义为 `airi-motion-control`。
  - 向大模型描述它正在控制一个名为 AIRI 的 Live2D 虚拟形象。
  - 教授大模型如何通过在对话文本中插入特定的 Token（如 `<|ACT:{"emotion":{"name":"happy","intensity":1}}...|>`）来驱动 AIRI 的动作。
  - 列出 AIRI 支持的核心动作/情绪字典（`happy`, `sad`, `angry`, `think`, `surprised`, `awkward`, `question`, `curious`, `neutral`）。
  - 规定只有在需要表现强烈情绪或特定动作时才输出该 Token，使表现活灵活现。

### [ ] 步骤 3: 验证对嘴部和眼部动画的影响
- **理论依据**: AIRI 前端的嘴部动画（Lip-sync）依赖于 TTS 语音流解析，而眼部动画（自动眨眼/跟随）由 `pixi-live2d-display` 的 `motion-manager.ts` 和内部钩子独立控制。
- **操作**: 大模型的动作指令本质上走的是 `emotionsQueue`，仅替换当前正在播放的 Motion Group，不会覆盖底层渲染循环中叠加的眨眼和口型参数。因此天然满足“除嘴部动画和眼睛动画外”的要求，无需对前端做额外破坏性修改。
- **验收**: 检查代码并确保前端 `live2d.ts` 或 `motion-manager.ts` 中针对眼/嘴的逻辑不受 ACT Token 影响。

## 3. 验收标准
- LobsterAI 生成流式回复时，可以通过携带 `<|ACT:...|>` 标签触发指定的 Live2D 情绪。
- Agent 执行工具或思考时，不再自动触发强硬绑定的固定动作。
- 模型在执行动作指令时，眨眼和说话时的口型同步依然正常运行。