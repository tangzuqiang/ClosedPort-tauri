# Testing

工具自带两套测试：E2E（不启动 GUI）+ Smoke（真 Electron 启动）。

## E2E

```bash
npm run test:e2e
```

- `tsc -p tsconfig.electron.json` 编译 main / shared
- Node 直接 `require` 编译产物，跑 [tests/e2e.js](../tests/e2e.js)
- 不启动 BrowserWindow，**纯后端**

检查项：

- 当前进程 PID 反查名称 / 路径
- 自己开 listener，端口能在 `listPorts()` 结果里被找到，含 `processName` + `parentPid`
- 起一个子进程绑端口，killer 杀完端口被释放
- 非法 PID 走错误分支不抛
- 文件夹扫描调用不抛

CI 友好：无网络依赖、无 GUI、无固定端口（用 `:0` 让内核分配）。

## Smoke

```bash
npm run test:smoke
```

- spawn 真 Electron 二进制
- 主进程内跑一次 `listPorts()`
- 检查 `handle.exe` 是否在 PATH / `resources/` 下
- 退出前清理所有 fake holder

进 CI 比较麻烦（Linux runner 还得 xvfb + Electron 沙盒），所以**目前仅供本地与发布前手动验证**。

## 截图回归（维护者使用，普通用户跳过）

> ⚠️ 这是仓库维护者用来重新生成 [docs/screenshots/](./screenshots/) 那几张图的开发者 hook，不是产品功能。普通用户、贡献者、CI 环境**不要**设置 `CLOSEDPORT_SCREENSHOT_DIR`，否则启动 ClosedPort 时它会进入截图模式：自动驱动 UI 跑一遍 → 写 PNG → `app.quit()` 直接退出。

主进程在 [src/main/index.ts](../src/main/index.ts) 中 `if (process.env.CLOSEDPORT_SCREENSHOT_DIR)` 这一段会启用这个分支。维护者重生截图：

```powershell
# Windows / PowerShell —— 用完务必清除该环境变量，否则下一次启动会再次自动退出
$env:CLOSEDPORT_SMOKE = $null
$env:CLOSEDPORT_SCREENSHOT_DIR = "$PWD\docs\screenshots"
npm run build; npx electron .
# 跑完后立刻：
$env:CLOSEDPORT_SCREENSHOT_DIR = $null
```

它会依次切到 Flat / Group by App / Folder Locks / Floating 四个 UI 状态，每个状态调用一次 `BrowserWindow.capturePage()` 写 PNG，然后退出。

## 提交前必跑

```bash
npm run test:e2e   # 必须通过
npm run build      # tsc + vite build 全绿
```
