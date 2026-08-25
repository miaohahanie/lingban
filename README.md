# 灵伴（Spirit Mate）

轻量级、开机自启的 AI 桌面伴侣：结合传统桌宠的陪伴感与 DeepSeek 大模型的规划、复盘能力。
女仆系桌宠 + 20 张情境 GIF 动画，常驻桌面提醒、规划日程、陪伴专注并温柔复盘。

## ✨ 已实现功能

- **桌宠本体**：透明置顶、鼠标穿透（交互区可点）、单例运行、系统托盘、位置记忆与拖动
- **GIF 动画引擎**：20 张「素材库」动画按事件触发（早安/专注/休息/鼓励/生日/整活等），支持优先级与冷却，可整体关闭/低功耗模式
- **初始化引导**：开机自启、工作日/工作时段、API Key（测试连接）、初始任务、生日（可选）
- **任务管理**：每日/每周/一次性任务，增删改查、完成/重开/归档、一次性任务按投入推进度
- **AI/本地规划**：DeepSeek 智能排期（无 Key 时本地启发式规划兜底），今日计划生成/确认/微调
- **专注计时器**：番茄钟/正计时/倒计时，关联任务，计入日记与统计
- **日记 + 复盘**：自由反思、自动完成记录、专注统计、AI 复盘评分与评语（本地公式兜底）
- **记忆碎片**：23:30 自动生成一句话记忆，保留最近 7 天，用于早安/聊天上下文
- **快捷指令**：/任务 /日记 /计时 /日历 /打开 /复盘 /动画 /写日记 /写入备忘录 /清空回收站 等，支持补全和历史
- **陪伴整活**：闲置自嗨、负荷绅士、连续专注健康提醒、深夜加班心疼、生日祝福（均可关闭）
- **设置页**：自启、自动规划、动画开关、整活开关、低功耗、生日、API Key、每日专注目标、言语库

## 🚀 快速开始

```bash
# 安装依赖（无需原生编译，安装更快）
npm install

# 开发模式（热更新）
npm run dev

# 构建
npm run build

# 运行构建产物
npm run start

# 打包 Windows 安装包（NSIS）
npm run dist
```

> 运行前可先复制/运行 `node node_modules/electron/install.js`（镜像加速）以确保 Electron 二进制已下载：
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
> ```

## 🗂️ 目录结构

```
灵伴/
├─ src/
│  ├─ main/            # Electron 主进程（窗口/托盘/数据/服务/IPC）
│  │  ├─ index.ts      # 应用生命周期、透明窗口、托盘、位置
│  │  ├─ db.ts         # 本地 JSON 数据层（SQLite 可就地替换）
│  │  ├─ services.ts   # AI/排期/情绪/动画/调度/指令/复盘等
│  │  └─ ipc.ts        # typed IPC 注册
│  ├─ preload/         # contextBridge 安全桥
│  ├─ shared/types.ts  # 全端共享类型与 API 契约
│  └─ renderer/        # Vue 3 + Pinia 界面
│     └─ src/
│        ├─ App.vue
│        ├─ store.ts
│        └─ components/  # PetView/Panels/Onboarding/Settings/CommandBar
├─ resources/
│  ├─ pet-anims/       # 素材库 GIF + manifest.json
│  └─ icon.png         # 托盘图标
├─ electron.vite.config.ts
├─ electron-builder.yml
└─ package.json
```

## 🔑 DeepSeek API

- 初始化引导或设置页填入 DeepSeek API Key（本地加密存储 `userData/secure/apikey.bin`）。
- 未配置 Key 时：规划、复盘、记忆、聊天全部自动降级为本地规则，应用仍可完整使用。
- API Key 不出主进程；本地路径、窗口位置不进入 AI Prompt。

## 💾 数据位置

```bash
# Windows
%APPDATA%/灵伴/lingban-data.json
%APPDATA%/灵伴/secure/apikey.bin
```

数据层当前使用 **零依赖 JSON 文件持久化**（避开 better-sqlite3 原生编译问题）。
接口已按 SQLite 风格封装，后续可将 `src/main/db.ts` 替换为 `better-sqlite3`/sql.js 实现而不影响其他模块。

## 🎞️ 素材动画映射（20 张）

| 事件 | 动画 |
|---|---|
| 早安 / 早晨首次互动 | 早上好呀 / 早上工作喵~ |
| 专注开始 | 工作ing（早间优先早上工作喵~） |
| 任务开始 | 主人加油呀~ |
| 任务完成 / 专注结束 | 主人好厉害！ / 顺利完成~ |
| 休息 | 休息ing |
| 午间关怀 | 该吃饭了 |
| 深夜加班 | 工作做晕了 / 加班 |
| 任务过多 | 工作越多越应该绅士 |
| AI 规划 | 思考ing → 鬼点子发动中 |
| 记录 / 复盘 | 在帮主人记录ing |
| 闲置/整活 | 小手机真好玩 / 抛媚眼~ |
| 启动 / 随机互动 | 突然出现~ / 最喜欢主人了~ |
| 生日 | 生日快乐 |

完整清单见 `resources/pet-anims/manifest.json`。

## 📌 已知边界（MVP）

- 日历周视图已支持查看/生成/确认/时间微调；月视图统计暂为简化版。
- "每周 X 次" 任务的重排频率控制为简化实现（连续排入为主）。
- 透明 GIF 建议正式打包前统一处理为透明底，以贴合新拟物态浅色背景。
- 打包产物由 `electron-builder` 生成，未在当前环境实测安装（依赖齐全，可运行 `npm run dist`）。

## 📄 许可声明（双许可）

本项目采用「代码 / 素材」分离的双许可模式：

| 范围 | 许可证 |
|---|---|
| 源代码（`src/` 等全部代码与配置文件） | [MIT](./LICENSE-CODE) |
| 表情包素材（`resources/pet-anims/` 内全部 GIF 动画） | [CC BY-NC-SA 4.0](./LICENSE-ASSETS) |

### 素材版权与署名

本项目包含的「蓝色大肥鱼」表情包素材，其版权链如下：

- **原创角色「鲸鱼娘‘溟月’」**：© [@上善无形](https://space.bilibili.com/4456176)（B站）
- **「女仆鲸鱼娘（DS鲸鱼娘）」二创形象**：© [@ZipZipPipe](https://space.bilibili.com/4168597)（B站）
- **「蓝色大肥鱼」表情包**：© [@赤风RED LUE UP](https://space.bilibili.com/356746604)（B站）

以上所有素材均采用 **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)** 协议授权：可自由分享与改编，但**不得用于商业用途**；二次分发或演绎时须以相同协议授权，并完整保留上述署名信息。

> 本项目为非商业的同人性质作品，与上述原作者无隶属关系。如版权方提出要求，本项目将及时移除相关素材。
