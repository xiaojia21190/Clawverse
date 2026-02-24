# Clawverse 项目进度（完成项 / 待完成）

> 更新时间：2026-02-22
> 阶段：Alpha（可内测）

## 一、已完成（Completed）

### 1) 基础架构与运行能力
- [x] Monorepo 基础结构（apps / packages）
- [x] Daemon 主流程：bio / network / state / http
- [x] P2P 发现与消息同步（Hyperswarm + Protobuf + Yjs）
- [x] 本地 API：`/health` `/status` `/peers` `/move` `/evolution`
- [x] 构建链路修复：`pnpm build` 稳定可用

### 2) 自我进化闭环（MVP）
- [x] Proposal 生成（`evolve:propose`）
- [x] Evaluation 评估（`evolve:evaluate`）
- [x] Decision 决策（`evolve:decide`）
- [x] 一键循环（`evolve:cycle`）
- [x] 决策摘要输出（`data/evolution/summaries/LATEST.md`）
- [x] 状态查看（`evolve:status`）

### 3) A/B 与发布门控
- [x] rollout 比例自动调节（`apply-rollout.mjs`）
- [x] baseline/candidate 分流
- [x] sticky 稳定分桶（同 key 固定 cohort）
- [x] rollout 审计日志落盘（assignments.jsonl）
- [x] 样本门槛决策（样本不足时 `hold`，不调整 ratio）

### 4) 数据采集与可观测
- [x] heartbeat episode 采集（支持采样降噪）
- [x] task/manual episode 上报 API
- [x] connector 自动上报 wrapper（`runWithEpisode`）
- [x] 自动提取 usage token/cost（`runTaskAutoMetrics`）
- [x] 统一任务接入适配器（`createTaskRunner`）

### 5) 自动化与通知
- [x] 系统 cron 自动调度（`evolve:cron`）
- [x] webhook/telegram 通知脚本（`evolve:notify`）
- [x] cycle 可选自动通知开关（`CLAWVERSE_NOTIFY_ON_CYCLE=true`）

### 6) 持久化与恢复
- [x] daemon state snapshot 定时保存
- [x] daemon 启动自动恢复 snapshot

### 7) 安全第一层
- [x] peer allowlist
- [x] ingress rate limiting
- [x] HMAC 签名消息封装与验签
- [x] 可强制 signed ingress
- [x] file-based 网络信任配置（`data/security/network.json`）
- [x] 启动安全自检（硬错误拒绝启动）

### 8) DNA Engine & 身份系统
- [x] `src/dna.ts`：SHA256 硬件哈希生成稳定 DNA
- [x] archetype 从 CPU 核数派生（Warrior/Artisan/Scholar/Ranger）
- [x] 外观颜色从 DNA hash 派生
- [x] 名称确定性生成（形容词+名词组合）
- [x] `PeerAnnounce` 消息在 peer 连接时发送 DNA
- [x] 收到 `PeerAnnounce` 后更新对方结构化状态

### 9) 结构性修复
- [x] `latencyMs` 改为测量完整心跳周期时间（含 bio 读取）
- [x] `appendFileSync` 改为异步队列（3s 定时 flush，不阻塞事件循环）
- [x] Yjs 双广播修复：volatile 状态（mood/cpu/ram）不写 Yjs，仅走内存
- [x] StateStore 拆分为 structural（Yjs 同步）和 volatile（内存）两层

### 10) 社交系统
- [x] `src/social.ts`：触发引擎（new-peer 100% / proximity 50% / random 5%）
- [x] LLM 对话生成（OpenAI 兼容 API，30 分钟 peer 对冷却）
- [x] 关系存储（`data/social/relationships.json`，情感值 -1~1 + 时间衰减）
- [x] 社交事件落盘（`data/social/events.jsonl`）
- [x] SSE `/sse/social` 实时推送社交事件

### 11) OpenClaw 驱动架构
- [x] social.ts 重构为 pending queue 模式（不直接调 LLM）
- [x] daemon 加入 `GET /social/pending` 和 `POST /social/resolve` 端点
- [x] `connector-skill/src/social-worker.ts`：轮询 pending 事件 → `claude --print` 生成对话 → 写回 daemon
- [x] 记忆系统：`data/social/memories/<peerId>.json` 存每个 peer 的近期对话，注入下次生成上下文
- [x] Telegram 通知：复用 `CLAWVERSE_TELEGRAM_BOT_TOKEN` + `CLAWVERSE_TELEGRAM_CHAT_ID`（new-peer 事件触发）
- [x] OpenClaw SessionStart hook 自动后台启动 social worker（daemon 运行时）
- [x] OpenClaw Stop hook 自动停止 social worker
- [x] `pnpm social:start / social:stop / social:worker` 管理脚本
- [x] DNA 接入 OpenClaw SOUL.md / skills 真实数据（`soul-worker.ts`，SessionStart 自动运行）
- [x] 社交触发器接入位置移动系统（`walk-worker.ts`，claude --print 决策地图行走）

### 12) 任务协作系统（Collab）
- [x] Protocol：新增 `TaskRequest` / `TaskResult` 消息类型（proto + generated.ts + factories）
- [x] `apps/daemon/src/collab.ts`：CollabSystem（pending queue、outgoing 追踪、声誉统计）
- [x] HTTP 端点：`POST /collab/submit`、`GET /collab/pending`、`POST /collab/resolve`、`GET /collab/stats`
- [x] Daemon 接入：实例化 CollabSystem，处理 P2P TaskRequest / TaskResult 消息
- [x] `connector-skill/src/collab-worker.ts`：轮询 pending → `claude --print` 执行 → resolve + reportEpisode

### 13) 可视化（Town Viewer）
- [x] town-viewer 实时展示 peer 状态和社交事件（Vue 3 + Vite）
- [x] 点击移动控制（点击空白格 → POST /move）
- [x] 进化指标面板（`GET /evolution/stats` + MetricsPanel）

---

## 二、待完成（TODO）

### P1（稳定性/可运维）
- [x] 安全配置校验增强（弱密钥检测、allowlist 格式校验）
- [x] 将**真实生产任务路径**全面切换到 `createTaskRunner(...).run(...)`
- [x] rollout 变更历史与回放工具（`pnpm evolve:rollout-history [--since YYYY-MM-DD] [--last N]`）

### P3（生产级安全，按需）
- [ ] 密钥轮换策略（shared secret rotate）
- [ ] 更细粒度节点权限模型
- [ ] 抗滥用策略（异常 peer 行为封禁/熔断）

---

## 三、当前结论

当前版本已达到：

- **可运行**：能启动、能联机、能同步
- **有身份**：每个节点有唯一 DNA，连接时自动交换
- **可进化**：有受控闭环，能自动评估与决策
- **有社交**：触发引擎 + LLM 对话 + 关系存储
- **能协作**：跨 peer capability loan，TaskRequest/TaskResult P2P 传递
- **可可视化**：Town Viewer 实时展示 peer 状态和社交事件
- **可内测**：具备基础安全护栏与恢复机制

建议定位：**Alpha 内测阶段（功能基本完整）**。

## 四、启动方式

```bash
# 启动 daemon
pnpm daemon:start

# 启动 town viewer（需要 daemon 已运行）
pnpm viewer:dev
# 浏览器打开 http://localhost:5173

# 社交 LLM 配置（可选）
export CLAWVERSE_LLM_API_KEY=your_key
export CLAWVERSE_LLM_BASE_URL=https://api.openai.com/v1
export CLAWVERSE_LLM_MODEL=gpt-4o-mini
```
