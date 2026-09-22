# Architecture

## 平台后端实现

| 能力              | Windows                                                  | macOS               | Linux                                |
| ----------------- | -------------------------------------------------------- | ------------------- | ------------------------------------ |
| 端口列表          | `netstat -ano -p TCP/UDP/TCPv6/UDPv6`                    | `lsof -nP -i -F`    | `lsof` → 缺则 `ss -tunlpH`           |
| 进程基本信息      | `tasklist /FO CSV /NH`                                   | `ps -p ... -o ...`  | `ps -p ... -o ...`                   |
| 进程路径 / 父进程 | **单次** `Get-CimInstance Win32_Process`（PowerShell）   | 同 ps               | `/proc/<pid>/exe` + `/proc/<pid>/cmdline` |
| 文件夹占用        | `handle.exe` → Restart Manager API                       | n/a                 | n/a                                  |
| 进程终止          | `taskkill /F /T`                                         | `SIGKILL`           | `SIGKILL`                            |
| 拖拽路径解析      | `webUtils.getPathForFile`                                | 同左                | 同左                                 |

> Windows 端故意没用 `tasklist /V`：在某些环境下会因为 `SeDebugPrivilege` 的细节导致输出在前几行被截断并 hang 数秒。详见 [src/main/utils/processInfo.ts](../src/main/utils/processInfo.ts) 顶部注释。

## 项目结构

```
src/
  main/                 Electron 主进程
    index.ts            应用启动 / 窗口 / 托盘 / IPC / 默认菜单移除
    entry.ts            程序入口；CLOSEDPORT_FAKE_PORT_HOLDER=1 时切到 fake-holder 分支
    portScanner.ts      端口扫描（netstat / lsof / ss），PID 0/4 命名归类
    folderScanner.ts    文件夹句柄扫描（Windows）：handle.exe → RM 一层递归回退
    killer.ts           跨平台进程终止
    devTools.ts         "Spawn test ports" 诊断；token + 父进程 liveness 校验
    utils/
      exec.ts           child_process exec / execFile 封装 + 超时
      processInfo.ts    进程详情批量预热（单次 PowerShell / Get-CimInstance）+ 5s TTL 缓存
  preload/
    index.ts            contextBridge 暴露 API + webUtils.getPathForFile 透传
  renderer/             Vite + React UI
    index.html          主窗口入口
    floating.html       悬浮窗入口
    src/                React 组件 + 样式（Tab display:none 持久化、TEST 高亮、Group 排序条、拖拽 overlay）
  shared/
    types.ts            PortEntry / FolderHandleEntry / FolderScanResult / SystemInfo / ApiSurface
    ipc.ts              IPC 通道常量

build/                  app icon 资产（由 scripts/make-icons.ps1 生成）
  icon.ico              Windows multi-size（16/24/32/48/64/128/256）
  icon.png              512x512，macOS / Linux / 运行时 BrowserWindow icon
  tray.png              32x32 托盘图标
  icons/                单尺寸 PNG（Linux .deb / AppImage）

scripts/
  make-icons.ps1        从任意 PNG 生成 build/icon.ico + 所有尺寸 PNG；用 -Source <path> 指定源图

tests/
  e2e.js                Backend E2E（不启动 GUI）
  smoke.js              真 Electron 启动 + IPC 路径冒烟

resources/              可选的 handle.exe / handle64.exe（被 .gitignore 忽略）

.github/workflows/
  ci.yml                push / PR 时跑三平台 build + e2e + ubuntu ss-fallback
  release.yml           push tag v* 时三平台打包并发布 Release
```

## 关键设计决策

### 为什么端口扫描走系统命令而不是 native 模块？

零原生依赖。`netstat` / `lsof` / `ss` 都是各平台默认或几乎默认有的工具，避免 N-API native module 编译/分发问题。代价：每次扫描会 fork shell，在 1k+ 端口的机器上有 ~200ms 开销，仍然完全够用。

### 为什么 PowerShell 一把梭查所有 PID 信息？

旧版用 `wmic`（已弃用）逐 PID 查询，会让 `WmiPrvSE.exe` CPU 飙到 50%+。当前用 `Get-CimInstance Win32_Process -Filter "ProcessId=A OR ProcessId=B OR ..."`，**N 个 PID 一次 WMI 查询**搞定。

### 为什么 spawned test holder 要用 token？

OS 会复用 PID。如果 holder 进程死了，操作系统把同一个 PID 分给真实进程，旧版仅靠 PID 判定就会把那个无辜进程错误地标成"我们 spawn 的 TEST holder"，导致橙色高亮 + 一键 Kill 误伤。现在 holder 启动时会读 `CLOSEDPORT_FAKE_HOLDER_TOKEN`（每次 spawn 用 `randomBytes(8).toString('hex')` 生成），stdout 上报 `PORT=<n> TOKEN=<t>`，必须 token 完全匹配才接受。Renderer 侧再加一道 PID-recycle guard：每次 refresh 后校验 (pid, port) 二元组在 `listPorts()` 结果里仍存在，否则剔除标记。

### 为什么 fake holder 要 2s 一次心跳父进程？

Electron `app.exit()` 会绕过 `before-quit` 直接拍死主进程，导致 spawn 出来的 holder 变成孤儿。holder 每 2 秒 `process.kill(parentPid, 0)`（POSIX 习惯做存活探测），父进程不在了就 `process.exit(0)` 自杀。这避免了 release 安装包用户测试完关闭 ClosedPort 后桌面残留 5 个 node 进程绑着随机端口。

### Folder scan：为什么默认下钻一层？

Restart Manager 接受文件路径而不是目录路径。如果只 `readdirSync` 顶层，子目录里被锁的文件根本没进 RM 注册列表，于是用户扫"大目录"得到空结果而以为坏掉了。现在 [collectFiles](../src/main/folderScanner.ts) 会顶层 + 一级子目录，上限 2000。完全递归被故意避开：RM 的 PInvoke 数组 + PowerShell 命令行长度都有上限，2000 是经验值。

### TEST 行为什么用 border-left 而不是 box-shadow inset？

`border-collapse: collapse` 下 `box-shadow: inset 4px 0 0` 在某些 Chromium 缩放下会被 cell edge 裁掉。换成 `td:first-child { border-left: 4px solid var(--warning) }` 不依赖 inset shadow 渲染，跨缩放稳定。
