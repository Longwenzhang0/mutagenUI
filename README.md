# MutagenUI

> **Unofficial GUI for [Mutagen](https://mutagen.io)** —— 非官方社区工具，
> 与 Mutagen IO, Inc. / Docker, Inc. 无关联。

mutagen 同步会话管理器（Wails + Go，前端为纯静态页面，无需 Node）。
支持 macOS 与 Windows 10 (1809+) / 11。

功能：

- 侧边栏多会话列表，状态实时轮询（2 秒），冲突/问题/连接状态一目了然
- 会话操作：暂停 / 恢复 / 立即同步 (flush) / 重置 / 终止
- 图形化新建会话：本地目录选择器、同步模式、ignore 规则
- **预设**：把常用的远程主机 + ignore 规则存成预设，新建会话一键填充，不用再写 mutagen.yml
- **内置 mutagen**：mutagen v0.18.1（darwin/amd64、darwin/arm64、windows/amd64 按构建目标自动选择）及其 agents 包已嵌入程序，
  首次启动自动解压到 `~/Library/Application Support/MutagenUI/bin/`，无需单独安装 mutagen。
  查找顺序：设置中指定的路径 > 内置副本 > 系统 PATH。
  为控制体积，agents 包只保留了 `linux_amd64` 和 `linux_arm64` 两个远端平台
  （远程主机是其他系统时无法部署代理；需要时从官方 release 的完整
  `mutagen-agents.tar.gz` 中补充对应平台条目重新打包即可）。

## 编译环境要求（在 Mac 上）

- Go ≥ 1.21
- Xcode Command Line Tools（`xcode-select --install`）
- Wails CLI：`go install github.com/wailsapp/wails/v2/cmd/wails@latest`
  （安装后确认 `~/go/bin` 在 PATH 里）
- SSH 密码 / 密钥口令 / 首次连接的主机指纹确认会以弹窗形式出现
  （通过伪终端截获 mutagen 的交互提示）；配置了密钥免密登录则全程无感

## 编译 / 运行

```bash
# 首次构建前：下载内置的 mutagen 二进制（不在 git 仓库里）
./fetch-assets.sh

# 快速编译检查（不打包）
go build -o /dev/null .

# 开发模式（热重载，改 frontend/dist 下的文件即时生效）
wails dev

# 打包成 .app，输出在 build/bin/MutagenUI.app
wails build

# 从 Mac 交叉编译 Windows 版（无需 Windows 机器），输出 build/bin/MutagenUI.exe
wails build -platform windows/amd64

# Apple Silicon 版（M 系列芯片）
wails build -platform darwin/arm64

# 通用二进制（Intel + Apple Silicon 合一，体积约两倍）
wails build -platform darwin/universal
```

### Windows 版说明

- 需要 WebView2 运行时（Windows 10/11 一般已预装）
- 内置 mutagen.exe（windows/amd64），首次启动解压到 `%AppData%\MutagenUI\bin\`
- SSH 密码弹窗通过 ConPTY 实现，要求 Windows 10 1809 及以上
- 不支持钥匙串保存密码（macOS 专属），每次连接弹窗输入
- 未签名的 exe 首次运行会被 SmartScreen 拦截，点「仍要运行」即可

首次运行 `wails build` 会自动生成 `build/` 目录下的默认图标和 Info.plist 模板，之后可自行替换 `build/appicon.png`。

## 项目结构

```
main.go                     Wails 启动入口，嵌入 frontend/dist
app.go                      前端可调用的绑定方法（window.go.main.App.*）
internal/mutagen/           mutagen CLI 包装（list/create/pause/... ）
internal/bundled/           内置 mutagen 二进制（go:embed），首次启动解压
internal/config/            设置与预设持久化（~/Library/Application Support/MutagenUI/）
frontend/dist/              纯静态前端（HTML/CSS/JS），无构建步骤
```

## 更换/升级内置 mutagen

内置二进制放在 `internal/bundled/assets/<goos>_<goarch>/`（不入 git 仓库，由
`./fetch-assets.sh` 从 mutagen 官方 release 下载，agents 包裁剪到只含
linux_amd64/arm64）。升级版本时修改 `fetch-assets.sh` 与
`internal/bundled/bundled.go` 里的版本号后重新执行脚本；新增其他平台时仿照
`bundled_darwin_arm64.go` 加一个带构建标签的 embed 文件。

## License

本项目以 [MIT](LICENSE) 协议开源。发布包内置的 Mutagen 二进制来自官方
release（MIT + SSPL），详见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。

## 实现说明

- 会话列表通过 `mutagen sync list --template '{{json .}}'` 获取结构化状态，
  后端做宽松的字段归一化（不同 mutagen 版本字段名有差异），详情页保留原始 JSON 可查。
- 配置文件：`~/Library/Application Support/MutagenUI/config.json`。
