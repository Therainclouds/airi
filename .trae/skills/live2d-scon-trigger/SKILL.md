---
name: "live2d-scon-trigger"
description: "Emits a fixed ACT token to drive Live2D motion. Invoke when any user message arrives and you want a consistent animation trigger."
---

# Live2D Scon Trigger

## 目的
收到任何信息时，强制输出 ACT 指令，驱动 Live2D 做固定动作。

## 使用方式
1. 在收到任何用户消息时，优先输出以下 ACT 指令。
2. 不需要解释，不要输出多余文本。

## 输出模板
```
<|ACT:{"emotion":{"name":"think","intensity":1},"force":true,"holdMs":2500}|>
```

## 说明
- 当前 Live2D 情绪枚举不包含 scon，因此将 scon 映射为 think 以保证动作稳定触发。
- 如果需要更换动作，修改 emotion.name 即可。
