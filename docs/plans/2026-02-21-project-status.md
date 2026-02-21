# Clawverse 项目进度（完成项 / 待完成）

> 更新时间：2026-02-21
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

---

## 二、待完成（TODO）

### P0（优先）
- [ ] 将**真实生产任务路径**全面切换到 `createTaskRunner(...).run(...)`
- [ ] 将通知正式接入现网 Telegram（机器人 token/chat id 实配）
- [ ] 增加进化周期失败告警（失败重试 + 告警分级）

### P1（稳定性/可运维）
- [ ] rollout 变更历史与回放工具（按时间线回溯）
- [ ] 进化指标可视化（简易 dashboard 或 JSON->图表）
- [ ] 安全配置校验增强（弱密钥检测、allowlist 格式校验）

### P2（小镇能力）
- [ ] DNA engine 真正接入运行路径
- [ ] 社交触发器（邻近/事件）与关系持久化
- [ ] 任务协作系统（基础奖励/声誉）

### P3（生产级安全）
- [ ] 密钥轮换策略（shared secret rotate）
- [ ] 更细粒度节点权限模型
- [ ] 抗滥用策略（异常 peer 行为封禁/熔断）

---

## 三、当前结论

当前版本已达到：

- **可运行**：能启动、能联机、能同步
- **可进化**：有受控闭环，能自动评估与决策
- **可内测**：具备基础安全护栏与恢复机制

建议定位：**Alpha 内测阶段**。
