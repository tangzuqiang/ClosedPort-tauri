# Development

> 给修代码 / 调 IPC / 改 UI 的人看。普通用户不需要本文。

## 环境

- Node 20.x（CI 用 20，本地 18+ 也能跑，更老的没测）
- 跨平台：Windows / macOS / Linux 都能开发

```bash
npm install
```

## 一键模式（启动应用，不带热更新）

```bash
npm start
```

跑完 `vite build` + `tsc -p tsconfig.electron.json`，然后用本地 electron 启动应用。改代码需要重跑。

## 双终端开发模式（热更新 renderer）

renderer 走 vite dev server，main 进程指向 `http://localhost:5173/`：

```bash
# 终端 1：启动 vite dev server
npm run dev
```

```powershell
# 终端 2 (Windows / PowerShell)
$env:CLOSEDPORT_DEV_SERVER = "1"
npm run build:main
npx electron .
```

```bash
# 终端 2 (macOS / Linux / bash / zsh)
export CLOSEDPORT_DEV_SERVER=1
npm run build:main
npx electron .
```

> 改 main 进程或 preload 代码后，需要在终端 2 重跑 `npm run build:main && npx electron .`。renderer 改动 vite 会自动 HMR。

## 诊断按钮：Spawn test ports（Windows）

工具栏右上角有个橙色虚线 **Spawn test ports** 按钮（仅 Windows 显示）。点击后会 fork 5 个子进程：

- 父进程是当前的 ClosedPort 进程（PPID 自动正确）
- 子进程使用 `ELECTRON_RUN_AS_NODE=1` 模式跑 [src/main/entry.ts](../src/main/entry.ts) 的 fake-holder 分支
- 每个子进程随机绑一个 TCP 端口
- 在 Flat 列表顶部以橙色高亮 + `TEST` 徽章浮起

**它们不会自动清理。** 用完点 Kill 或在 Group by App 视图整组 Kill 释放。

> 如果点了没反应：[src/main/devTools.ts](../src/main/devTools.ts) 必须把 entry.js 路径作为 `argv[1]` 传进 `spawn`，否则 `ELECTRON_RUN_AS_NODE=1` 会让 Electron 进入 Node REPL，永远不会进 fake-holder 分支。改了 devTools 又踩到 "No test ports were spawned"，先检查这个。

诊断按钮在 packaged 安装包里**也保留**了（便于线上排障）。如需在 release 里彻底隐藏，把 [src/main/index.ts](../src/main/index.ts) 中 `devToolsEnabled` 改成 `os.platform() === 'win32' && !app.isPackaged` 即可。

## 主要源码入口

| 路径 | 作用 |
| --- | --- |
| [src/main/entry.ts](../src/main/entry.ts) | 主进程入口；`CLOSEDPORT_FAKE_PORT_HOLDER=1` 时切到 fake-holder 分支 |
| [src/main/index.ts](../src/main/index.ts) | 应用启动 / 窗口 / 托盘 / IPC / 默认菜单移除 |
| [src/main/portScanner.ts](../src/main/portScanner.ts) | 端口扫描（netstat / lsof / ss），PID 0/4 命名归类 |
| [src/main/folderScanner.ts](../src/main/folderScanner.ts) | 文件夹句柄扫描（Windows） |
| [src/main/killer.ts](../src/main/killer.ts) | 跨平台进程终止 |
| [src/main/devTools.ts](../src/main/devTools.ts) | "Spawn test ports" 诊断 |
| [src/preload/index.ts](../src/preload/index.ts) | contextBridge API（含 `webUtils.getPathForFile` 给拖拽用） |
| [src/renderer/src/App.tsx](../src/renderer/src/App.tsx) | 主窗口 React 入口 |
| [src/renderer/src/Floating.tsx](../src/renderer/src/Floating.tsx) | 悬浮迷你面板 |
| [src/shared/types.ts](../src/shared/types.ts) | `PortEntry` / `FolderHandleEntry` / `SystemInfo` / `ApiSurface` |
| [src/shared/ipc.ts](../src/shared/ipc.ts) | IPC 通道常量 |
