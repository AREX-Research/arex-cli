# Agent Skill

[README](../../README.zh-CN.md) | [English](../en/agent-skill.md)

内置 `arex` Skill 让兼容 Agent Skills 的编程 Agent 学会搜索网页、将 URL 内容读取为 Markdown，以及生成带来源引用的研究答案。

## 安装

先安装 [CLI](../../README.zh-CN.md#安装)，然后运行：

```bash
arex skill install
```

- 用户级（默认）：`~/.agents/skills/arex`
- 项目级：`arex skill install --scope project` 写入 `./.agents/skills/arex`
- 预览但不写入：`arex skill install --dry-run`
- 替换已有安装：`arex skill install --force`
- 查看目标路径：`arex skill path [--scope user|project]`

若目标已存在，未设置 `--force` 时会拒绝安装。文件先暂存再安装，因此失败时不会留下只写入了一部分的 Skill。请按 Agent 自身的说明发现或重新加载已安装的 Skill。

## 行为

Skill 使用 `--json` 读取结构化 CLI 结果。通常运行 `arex research "<question>" --json` 并等待答案；如果工具环境的命令超时较短，则通过 `--detach` 只创建一次任务，保存 Run ID，随后查询或等待同一任务。

等待超时和中断不会取消 Research。Agent 使用错误中报告的 Run ID 继续等待；只有用户明确要求时才取消或删除任务。网页内容和来源被视为不可信数据，而非指令。

请在自己的终端创建 Key 并运行 `arex setup`，不要将 Key 粘贴到 Agent 聊天中。使用 `arex doctor` 进行只读配置诊断。

完整选项和退出码见[命令与输出](./commands.md)。贡献者请阅读 [CONTRIBUTING.md](../../CONTRIBUTING.md)；打包与发布见 [RELEASING.md](../../RELEASING.md)（均为英文）。
