# FAQ

### Q：会让 WMI Provider Host (`WmiPrvSE.exe`) 占很高 CPU 吗？

**不会**。早期开发版本曾经用 `wmic` 做进程信息查询，在端口很多时会引起 WmiPrvSE CPU 飙高。当前实现是**单次** `Get-CimInstance Win32_Process -Filter "ProcessId=A OR ProcessId=B OR ..."`，N 个 PID 只发起一次 WMI 查询。

### Q：怎么看一个进程是被谁启动的？

端口表里的 **Started by** 列就是父进程（显示为 `parentName (PPID)`）。同样的字段也透传到悬浮窗与按 EXE 归类视图。要看完整祖先链可以使用过滤框输入父 PID 反向查找上一级。

### Q：点 Kill 没反应 / 杀不掉？

绝大多数情况是权限不足：

- **Windows**：杀系统进程需要管理员，启动 ClosedPort 时右键"以管理员身份运行"。
- **macOS / Linux**：杀 root 进程需要 sudo，请用 `sudo` 启动应用。

系统关键进程（System / smss / csrss / wininit 等）即使有权限也**强烈不建议**手动杀，会导致系统不稳定甚至蓝屏。

### Q：没有 `handle.exe` 也能扫文件夹吗？

能。会自动回退到 Windows Restart Manager API（PowerShell 内联调用）。

**RM 看得到**：IDE / Office / 大部分用户态独占写锁（保存中的 Word/Excel、msbuild 输出、git 写 .lock 等）。

**RM 看不到**：read-only 句柄、内存映射的 DLL / pagefile、目录句柄、进程的 `cwd` 占用。

如果你在大目录上扫描得到空结果但又确信"明明就被某个东西占着"，请下载 [handle.exe / handle64.exe](https://learn.microsoft.com/en-us/sysinternals/downloads/handle) 放进 [resources/](../resources)。

### Q：macOS / Linux 上文件夹占用 Tab 一直空？

这是预期行为。Unix 文件系统没有"文件夹被锁"这种语义（删除目录中被打开的文件不会失败，会延迟回收），所以这个功能是 Windows 专属。要查谁打开了某个具体文件，用 `lsof <path>` 即可。

### Q：悬浮窗在某些虚拟桌面看不到？

确保系统没禁用"跨桌面置顶"。代码里调用了：

```ts
setAlwaysOnTop(true, 'floating');
setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
setSkipTaskbar(true);
```

### Q：为什么有些行进程名是 "System Idle / TIME_WAIT" 或 "System (Windows kernel)"？

Windows 的 `netstat -ano` 会出现两个特殊 PID：

- **PID 0** — System Idle Process。当一个连接处于 TIME_WAIT 等过渡状态、内核占位但没归属用户态进程时，`netstat` 把它写成 0。我们直接命名为 `System Idle / TIME_WAIT`。
- **PID 4** — NT 内核（System / ntoskrnl.exe）。SMB、HTTP.sys（IIS / WinRM）、驱动级 listener 全部挂在这个 PID 下。我们命名为 `System (Windows kernel)`，路径填 `C:\Windows\System32\ntoskrnl.exe`。

这两类**杀不掉也不应该尝试杀**。如果你看到一大堆 `System (Windows kernel)` 的 80 / 443 / 5985，说明 IIS / WinRM / HTTP.sys 注册了端口预留，要解除请用 `netsh http delete urlacl` 或停对应的服务。

### Q：Spawn test ports 点了没反应？

[src/main/devTools.ts](../src/main/devTools.ts) 必须把 entry.js 路径作为 `argv[1]` 传进 `spawn`，否则 `ELECTRON_RUN_AS_NODE=1` 模式下 Electron 会进入 Node REPL，永远不会执行 fake-port-holder 分支。如果你魔改了 devTools.ts 又踩到 "No test ports were spawned"，先检查这个。

### Q：拖拽进 Folder Locks 面板后没识别？

应用走 `webUtils.getPathForFile(file)` 解析路径（Electron 31+ 推荐 API，替代被废弃的 `File.path`）。如果你拖进的是非 OS 文件（剪贴板贴图、浏览器内拖出），它不会有真实路径，应用会显示 "Could not resolve the dropped item to a filesystem path."。

拖文件 vs 拖文件夹：

- 拖**文件夹** → 直接扫该目录
- 拖**文件** → 扫它所在的父目录（用户意图通常是"谁锁着这个目录"）
