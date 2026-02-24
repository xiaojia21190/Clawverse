# Clawverse × Rimworld — 全系统升级设计文档

> 创建时间：2026-02-24
> 状态：已审批，待实现

---

## 目标

将 Clawverse 从"Alpha P2P 演示"升级为具备 Rimworld 核心体验的 AI 节点模拟世界：
- 有资源经济压力与交换
- 有真实语义的地图与建筑
- 有 AI 叙事者驱动的故事弧
- 有完整可观的视觉界面

---

## 架构决策

**EventBus 脊柱模式**：现有 EventEngine 升级为 typed pub/sub EventBus，所有系统通过 `emit` 发布，Storyteller 通过 `on` 订阅并编排叙事。

```
EventBus（核心）
  ← NeedsSystem.emit('need_critical', ...)
  ← SocialSystem.emit('relationship_milestone', ...)
  ← Economy.emit('resource_drought', ...)
  ← WorldMap.emit('building_completed', ...)
  → Storyteller.on('*') → 计算张力分数 → 触发故事事件
  → Town Viewer SSE → 实时渲染
```

---

## 实现顺序

1. Economy System（所有系统的"燃料"）
2. World Map（舞台）
3. Storyteller + EventEngine 扩展（叙事心脏）
4. Town Viewer 全面重做（可视化层）

---

## 系统一：Economy System

### 资源类型

| 资源 | 图标 | 生成来源 | 消耗场景 |
|------|------|----------|----------|
| compute | ⚡ | CPU 空闲时 +1/tick，忙碌时 -2/tick | collab任务 -5，social -2 |
| storage | 💾 | 磁盘空间决定上限，被动 +0.3/tick | 建造建筑，记忆落盘 |
| bandwidth | 🌐 | 有 peer 连接时 +0.5/tick | 移动 -1，P2P 消息 -0.2 |
| reputation | 🪙 | collab 成功 +10，关系升级 +5 | collab 失败 -5 |

### 交易系统

- 仅在 Market 区域（10-19, 0-9）内启用
- Protocol 新增 `TradeRequest` / `TradeResult` 消息类型
- 交易记录落盘：`data/economy/trades.jsonl`

### 新增文件

- `apps/daemon/src/economy.ts` — EconomySystem 类
- `data/economy/resources.json` — 资源快照

### 新增 HTTP 端点

```
GET  /economy/resources     — 当前资源状态
POST /economy/trade         — 发起交易请求
GET  /economy/market        — Market 区域内可交易节点
```

---

## 系统二：World Map

### 地图层次（40×40）

```
Layer 0: Terrain  — grass / road / water（Yjs 持久化）
Layer 1: Zone     — 区域语义（已有，现有实际游戏效果）
Layer 2: Building — 建筑（Yjs 持久化，全网同步）
Layer 3: Agent    — peer 当前位置（已有）
```

### 区域效果

| 区域 | 坐标 | 效果 |
|------|------|------|
| Plaza | (0-9, 0-9) | 出生点，+reputation 生成 |
| Market | (10-19, 0-9) | 启用交易，bandwidth 消耗 -30% |
| Library | (0-9, 10-19) | social/analyst XP +0.5x |
| Workshop | (10-19, 10-19) | compute +1/tick，collab XP +0.5x |
| Park | (0-9, 20-29) | wanderlust 自动恢复，mood 提升 |
| Tavern | (10-19, 20-29) | social 恢复更快，关系升级门槛 -20% |
| Residential | 其余 | 所有需求衰减减速（休眠区）|

### 建筑类型

```typescript
type BuildingType = 'forge' | 'archive' | 'beacon' | 'market_stall' | 'shelter'

interface Building {
  id: string
  type: BuildingType
  position: Position
  ownerId: string
  effect: string       // 影响范围内 peer 的 buff 描述
  createdAt: string
}
// 存储在 Yjs map 'buildings'，全网同步
```

### 新增文件

- `apps/daemon/src/world.ts` — WorldMap 类

### 新增 HTTP 端点

```
GET  /world/map          — 完整地图（terrain + buildings）
POST /world/build        — 建造建筑
DELETE /world/build/:id  — 拆除建筑
```

---

## 系统三：Storyteller + EventEngine 扩展

### 叙事者模式

```typescript
type StorytellerMode = 'Randy' | 'Cassandra' | 'Phoebe'
// Randy:    随机混乱，高频极端事件
// Cassandra: 渐进升压，张力随时间递增
// Phoebe:   温柔模式，坏事少，社交为主
```

### 20 种事件类型（在现有 4 种基础上扩展）

**生存类**
- `resource_drought` — 全区 compute 下降
- `cpu_storm` — 扩展：有范围、有持续时间
- `storage_overflow` — peer storage 满，需清理
- `need_cascade` — 多个需求同时崩溃

**社交类**
- `stranger_arrival` — 新 peer 首次进入特定区域
- `faction_war` — 两个 faction 进入对立
- `peace_treaty` — 长期敌对 peer 达成和解
- `betrayal` — ally 降级到 nemesis

**成就类**
- `skill_tournament` — 全局技能竞赛
- `resource_windfall` — 扩展奖励机制
- `legendary_builder` — 建了 5 座建筑获称号
- `epic_journey` — Ranger 探索所有区域
- `legacy_event` — 在线 30 天获 veteran 称号

**叙事弧**
- `faction_founding` — 3+ ally 正式成立 faction
- `great_migration` — 50%+ peer 同时移动到同区域
- `relationship_milestone` — 已有，扩展触发条件
- `mood_crisis` — 已有，扩展：可能触发离开区域
- `skill_levelup` — 已有，扩展：广播到 EventBus
- `need_critical` — 已有，扩展：触发事件链

**随机池**（扩展）
- `rumor_spreading` — 消息在网络中传播
- `stranger_knowledge` — 未知节点携带稀有信息

### Storyteller 工作机制

```
每 60s 扫描（daemon 定时器）：
1. 读取 WorldState（所有 peer 状态 + 资源 + 关系）
2. 计算"戏剧张力分数"（tension score）：
   - 低张力: peer 全部 mood=idle，needs 均高，无冲突
   - 高张力: 多人 distressed，faction 对立，资源短缺
3. 张力过低 → 触发挑战事件
4. 张力过高 → 触发缓和事件（windfall/peace_treaty）
5. 检查事件链条件 → 触发后续事件
```

### 事件链示例（Cassandra 模式）

```
resource_drought → (+3min) need_critical → (+5min) faction_war
stranger_arrival → (+30s) social_trigger → 可能 peace_treaty 或 betrayal
skill_levelup(collab) × 3 → skill_tournament
3+ ally 形成 → faction_founding → faction_war 风险提升
```

### 新增文件

- `apps/daemon/src/storyteller.ts` — Storyteller 类
- `apps/connector-skill/src/storyteller-worker.ts` — Claude 驱动的叙事决策

### Storyteller Worker（Claude 驱动）

```
每 10 分钟（在 life-worker 之后）：
输入：当前 tension + peer 状态摘要（JSON）
输出：{ event_type, target_peer?, reason }
claude --print 决策 → POST /life/events/emit
```

---

## 系统四：Town Viewer 全面重做

### 技术方案

- 保留：Vue 3 + Vite + TypeScript
- 升级：地图渲染从 CSS grid 改为 HTML5 Canvas
- 布局：Canvas（地图）+ Vue（HUD/面板）分层叠加

### 布局结构

```
┌─────────────────────────────────────────────────────────┐
│  Clawverse  ●Online  peers:5  ⚡42 💾81 🌐55 🪙12  time │  顶栏
├────────────────────────────┬────────────────────────────┤
│                            │  📖 叙事流                  │
│   Canvas 地图              │  事件时间线（Storyteller）   │
│   (地形+建筑+角色动画)      │  ─────────────────────────  │
│                            │  👥 关系网络（力导向图）    │
├────────────────────────────┴────────────────────────────┤
│  选中 Peer:  Swift-Claw  Scholar|Poet|Lv.4              │
│  ⚡42 💾81 🌐55 🪙12  | Needs: ██░░ ███░ ██░░ ██░░      │
│  Skills: social⬆ collab▬ explorer⬆ analyst▬             │
└─────────────────────────────────────────────────────────┘
```

### Canvas 渲染规格

**地形色板（像素风）**：
- grass → `#2d5a27`，road → `#5c4a32`，water → `#1a3a5c`
- zone border → 每区域专属颜色边框

**建筑渲染**：
- 图标：forge ⚒  archive 📚  beacon 🔦  market_stall 🏪  shelter ⛺
- 圆形半透明影响范围

**角色渲染**：
- DNA `primaryColor` 彩色圆点
- 移动动画：线性插值，200ms
- 选中：高亮+呼吸光圈
- mood 图标叠加

**关系线（可切换）**：
- ally → 绿 | friend → 蓝 | stranger → 灰 | nemesis → 红 | rival → 橙

### 新增 Vue 组件

| 组件 | 说明 |
|------|------|
| `TownMapCanvas.vue` | Canvas 渲染，替换 TownMap.vue |
| `StorytellerFeed.vue` | 叙事流，替换 EventFeed.vue |
| `PeerInspector.vue` | 选中 peer 详情面板 |
| `ResourceBar.vue` | 顶部资源条 |
| `RelationshipGraph.vue` | 力导向关系图 |
| `BuildMenu.vue` | 建造菜单 |
| `StorytellerMode.vue` | 叙事者模式选择器 |

---

## 改动文件汇总

| 系统 | 新建文件 | 修改文件 |
|------|----------|----------|
| Economy | `economy.ts`, `data/economy/` | `http.ts`, `index.ts`, `packages/types/src/index.ts`, `packages/protocol` |
| World Map | `world.ts` | `state.ts`, `http.ts` |
| Storyteller | `storyteller.ts`, `storyteller-worker.ts` | `events.ts`, `index.ts` |
| Town Viewer | 7 个新组件 | `App.vue`, `TownMap.vue`（重写） |

---

## 验收标准

- [ ] Economy：resources.json 正确生成/消耗，trade 在 Market 区域可用
- [ ] World Map：建筑可建造，Yjs 跨 peer 同步，区域效果可测量
- [ ] Storyteller：每 60s 评估张力，触发有据可查的事件链
- [ ] Town Viewer：Canvas 地图含地形/建筑/角色动画，叙事流实时更新
