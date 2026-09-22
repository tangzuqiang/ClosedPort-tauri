# Packaging & Release

## 本地打包

```bash
npm run dist:win     # Windows: NSIS 安装包 + 便携版（exe + Setup.exe）
npm run dist:mac     # macOS:   dmg + zip
npm run dist:linux   # Linux:   AppImage + deb
```

产物输出到 [release/](../release)。

## 让 Windows 文件夹扫描更全面

把 [handle.exe / handle64.exe](https://learn.microsoft.com/en-us/sysinternals/downloads/handle) 拷贝到仓库根目录的 [resources/](../resources) 下。

- `.gitignore` 已忽略它们，不会污染版本库
- electron-builder 会把 `resources/` 整目录打进发布包
- 缺失时应用会**自动回退**到 Windows Restart Manager API（可见 user-mode 锁，看不到 read-only 句柄 / mmap / cwd）

## 签名 / 公证状态

| 平台 | 当前状态 | 用户首次运行的影响 |
| --- | --- | --- |
| Windows | **未签名** | SmartScreen 提示"未知发布者"。文件属性勾"解除锁定"即可。 |
| macOS | **未签名 / 未公证** | Gatekeeper 拦截。系统设置 → 隐私与安全 → 仍要打开。 |
| Linux | n/a | AppImage / deb 直接运行 |

如果你 fork 后想在 CI 里自动签名 + 公证，给仓库配以下 secrets：

- Windows code-signing：`CSC_LINK`（pfx base64）+ `CSC_KEY_PASSWORD`
- macOS notarization：`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`

electron-builder 会自动检测并启用。

## CI Release（push tag → 自动发包）

[.github/workflows/release.yml](../.github/workflows/release.yml) 监听 `push tag v*`，三平台并行构建，附 SHA256 校验，发布到 GitHub Releases。

发布步骤：

```bash
git tag v0.1.0
git push origin v0.1.0
```

CI 跑完后到 Releases 页面校验产物 + 把状态改成 published 即可。

## CI 持续集成

[.github/workflows/ci.yml](../.github/workflows/ci.yml) 在 push / PR 时跑：

- `windows-latest` × build × e2e
- `macos-latest` × build × e2e
- `ubuntu-latest` × build × e2e
- `ubuntu-latest, ss fallback` × 卸 `lsof` 后跑 e2e（强制覆盖 `parseSs` 分支，避免最小化发行版回归）

smoke 没进 CI（要 spawn 真 Electron 二进制 + xvfb），仅本地与发布前手动验证。
