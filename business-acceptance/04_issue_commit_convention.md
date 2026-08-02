# 项目管理约定 — issue 关联与提交规范

> 记录日期：2026-08-02
> 目的：避免再次出现"issue 关了但忘了标记对应提交"的问题。

## 约定 1：commit 消息用 GitHub magic 关键字自动关联 issue

以后提交实现某 issue 的代码时，commit 消息必须使用 GitHub 能识别的关联关键字，让 GitHub 自动把提交关联到对应 issue/PR，并在 issue 关闭时展示：

- `Closes #4` / `Fix #4` / `Fixes #5` / `Resolves #6`（单 issue）
- 一次提交涉及多 issue 可并列：`Closes #4, #5`
- 示例：`feat: 主拓扑3D分层(issue#4) Closes #4`

这样 GitHub 会在 issue 的时间线里显示"dbro-walone linked a pull request / commit that closed this issue"，无需手动补评论。

（注意：`Closes #N` 在合并到默认分支时会**自动关闭**该 issue；已关闭的 issue 用 `Fixes #N`/`Refs #N` 更稳妥。）

## 约定 2：一个 issue 多阶段/多提交时，分阶段标注对应 commit

像 issue#4（4 个 commit）、issue#6（3 个阶段，每个阶段一个 commit）这种，会在最终汇总注释里列出"阶段/功能 → commit"完整对应，方便追查：

- 阶段A → `e87de34`
- 阶段B → `593bdb3`
- 阶段C → `b362050`

历史的三个 issue 对应提交（已补关联评论到 GitHub）：

| Issue | 对应 commit |
|---|---|
| #4 拓扑展示优化 | c8cfd57, e140ddd, 270f2d8, 776e30f |
| #5 LUI交互优化 | 270f2d8 |
| #6 LUI展示优化V2 | e87de34(阶段A), 593bdb3(阶段B), b362050(阶段C) |

## 补充：本次用评论补救的原因
已推送的 commit 改作者消息需要 force-push 改 SHA，不推荐；所以在已关闭 issue 上补评论引用 commit（GitHub 自动转链接），是最安全的后补方式。
