# 第三方软件与许可

MutagenUI 本身以 MIT 协议发布（见 [LICENSE](LICENSE)）。它使用/分发以下第三方软件：

## Mutagen（运行时调用 + 发布包内置二进制）

- 项目：<https://github.com/mutagen-io/mutagen>
- 版权：Copyright (c) 2016-present Docker, Inc.
- 协议：仓库主体为 **MIT License**；`sspl/` 目录下的代码为 **Server Side
  Public License (SSPL)**。自 v0.17 起，官方 release 二进制默认包含 SSPL
  许可的代码。
- 本项目的源码仓库**不包含**任何 Mutagen 代码或二进制（构建前由
  `fetch-assets.sh` 从官方 release 下载）。本项目的**发布安装包**内置了
  未经修改的官方 Mutagen release 二进制（含其裁剪后的 agents 包），其源码
  可在上述官方仓库获取，完整许可文本见
  <https://github.com/mutagen-io/mutagen/blob/master/LICENSE>。
- MutagenUI 与 Mutagen IO, Inc. / Docker, Inc. 无关联，为非官方社区工具。

## Go 依赖库

| 依赖 | 协议 | 链接 |
| --- | --- | --- |
| Wails v2 | MIT | <https://github.com/wailsapp/wails/blob/master/LICENSE> |
| creack/pty | MIT | <https://github.com/creack/pty/blob/master/LICENSE> |
| UserExistsError/conpty | MIT | <https://github.com/UserExistsError/conpty/blob/master/LICENSE> |
| golang.org/x/sys 等 golang.org/x 库 | BSD-3-Clause | <https://cs.opensource.google/go/x/sys/+/master:LICENSE> |
| Go 标准库 | BSD-3-Clause | <https://go.dev/LICENSE> |

以上依赖的完整版权与许可声明以各自仓库中的 LICENSE 文件为准；分发本软件的
二进制时视为一并附带上述声明。
