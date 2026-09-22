# ClosedPort (Tauri)

这是 `D:\\wwwroot\\electron\\ClosedPort` 的 Tauri 2 + React + Rust 版本，保留端口、进程、目录占用、启动项、hosts、终端、脚本、托盘与悬浮窗功能。

```powershell
npm install
npm run tauri:dev
```

构建安装包：

```powershell
npm run tauri:build
```

发布更新：在 `update.txt` 末尾追加 `版本号 更新说明`，复制
`scripts/.update-server.env.example` 为 `scripts/.update-server.env` 并填写发布凭据，然后运行：

```powershell
npm run update
```

该命令会同步三处版本号、构建 NSIS 安装包、计算 SHA256、生成更新清单并上传。
完整步骤见 `docs/更新流程.md`。

Windows 上部分系统操作（终止系统进程、编辑系统启动项/hosts）需要以管理员身份运行。
