# FoldUStory Skill for Codex

把下面这句话复制给 Codex：

> 请从 https://github.com/Promylas/foldustory-skill 安装 FoldUStory Skill，先检查内容并运行 node install.mjs --dry-run，再安装并连接 https://foldustory.com/agent。如果已经安装，请保留现有配置并先查询可用功能。由我在网页登录 Creator 账号、选择并授权自己的测试作品后，按我的描述编辑、检查预览并保存到云端。

安装包版本 **1.1.0**。嵌套机关创作正在指定账号和测试作品中开放，以所选作品返回的功能列表为准；原有基础编辑仍可使用。已有连接器可继续连接，无需为获得服务端开放的函数重复安装。

## 第一次使用

1. 准备 **Node.js 22 或更高版本、Codex CLI 和 FoldUStory Creator 账号**。安装器检查环境，不会购买套餐或开通付费。使用系统代理时需要支持 `--use-env-proxy` 的 Node.js 版本，启动器会检查。
2. 从本仓库 **Code → Download ZIP** 下载并解压，或 `git clone https://github.com/Promylas/foldustory-skill.git`。[实验室](https://foldustory.com/lab#agent-skill)也提供完整安装包。
3. 在安装包目录运行：

   ```sh
   node install.mjs --dry-run
   node install.mjs
   ```

   安装器安装 `skills/foldustory` 并注册名为 `foldustory` 的 MCP 连接器，保留其他 MCP 配置。已有不同的同名安装会停止并报告，不静默覆盖。完成后重新打开 Codex 会话加载 Skill 和工具。
4. 告诉 Codex：**“使用 $foldustory 连接我的个人空间。”** 它会返回授权网址和用户码。
5. 在该网址登录 FoldUStory，核对客户端和用户码，勾选**自己的云作品**，点击授权。普通账号不能授权。本机作品请先在[个人空间](https://foldustory.com/projects)明确备份到账号并确认云保存成功。
6. 保持授权网页打开且可见，让 Codex 打开你指定的作品。描述修改要求，查看网页预览，最后要求“保存到云端”。只有收到服务端确认和云版本号才表示保存完成。

可以先说：“把我刚授权的测试作品改名为‘森林贺卡’，再读取组件和可用参数，告诉我接下来能怎么改。”改结构前先查询实际组件、纸面与顶点，改后检查合上和展开的结果。

## 授权与作品保护

- Creator 身份和作品归属由服务器验证，Skill 不能赋予权限。每次授权最多选择本人 10 份云作品，约一小时有效。
- 在 [Agent 授权页](https://foldustory.com/agent)随时撤销。也可让 Codex 断开；只有 `revoked: true` 才表示远端撤销成功，断网时请回网页撤销。
- 退出网站账号撤销该登录会话的授权。授权页关闭或停止响应后，短期浏览器租约到期，Agent 停止工作；继续使用时回网页确认。
- 不要把密码、验证码或浏览器令牌发给 Agent。连接器仅在进程内存保留临时访问令牌。
- 预览修改和云保存是两步。遇到冲突、断网或结果未知，先检查作品与版本，不重复执行修改。编辑页可下载当前副本；原有云版本和原图按网站存档机制保留。
- 本连接器不会把作品自动发布到模型广场，公开分享需要另外提交。

## 能做什么

| 作品 | 当前能力 |
| --- | --- |
| 立体书 Scene | 查询组件和连接面、改参数、换图、复制/删除组件、调整书本尺寸、检查开合与约束、撤销/重做 |
| 纸样 PaperPattern | 查询顶点/折痕/纸面，调整几何、构造纸样、预览与修改胶接、折叠与开合检查 |
| 制作草稿 | 读上下文、改名、保存；暂不支持完整素材制作流程 |

实际函数以连接后的 `describe-tools` 和服务端允许列表为准，并非整个工作台的所有功能。没有模板批量导出、未授权作品读取或本机文件读取工具。几何模拟不能代替实体试做。

已开放嵌套创作的作品还可以查询真实纸面和折线，在已有机关上继续安装 V 折、台阶或纸面，通过统一参数修改父机关，并让后代跟随。浏览器与 Agent 共用撤销历史。可以复制给 Codex：

> 先查询这份测试作品的可用函数和图层树。如果支持嵌套创作，在一个合适的父机关上添加子机关，先预览安装位置，再检查父机关变化时子机关是否跟随；检查合上和展开，保留原图与连接关系，最后保存到云端并报告确认版本。

暂未返回相关函数时，不要尝试绕过限制或读取平台模板。新机关由现有底层构造、安装和求解能力组合而成；这不等于能在网页中随意增加新的求解器代码。

## 如何工作

```text
Codex + Skill → 本机 MCP 连接器 → 网站授权与任务接口
                                       ↓
                            已授权网页文档函数与预览
                                       ↓
                              版本检查 → 云端保存
```

Skill 指导选作品、查能力、检查版本和结果；Node.js 连接器传递函数请求。网页计算几何并显示预览，服务器检查权限和保存版本。无需本地部署网站，也不依赖 Computer Use 逐个点击。网页轮询任务，响应时间还受网络、页面是否可见和计算量影响。

本仓库只公开安装器、Skill 和轻量连接器，不包含工作台引擎、网站源码、平台模板或用户资产。MIT 许可仅适用于本仓库文件，不授予网站内容、模板或其他创作者作品的权利。

## 关于 FoldUStory

[FoldUStory 纸事](https://foldustory.com) 是在线立体书与纸机关创作工作台。组合机关、放入图稿、查看开合，并在个人空间保存作品；[模型广场](https://foldustory.com/models)展示审核后的创作者投稿，[实验室](https://foldustory.com/lab)介绍 Agent 创作和其他探索。

目前先支持 Codex，其他 Agent 的安装与授权流程需要分别验证。
问题反馈：[GitHub Issues](https://github.com/Promylas/foldustory-skill/issues) 或 foldustory.support@gmail.com。请提供错误码和操作步骤，不附令牌或未经授权的作品。

## English quick start

Copy this instruction to Codex:

> Install the FoldUStory Skill from https://github.com/Promylas/foldustory-skill. Inspect its contents and run node install.mjs --dry-run before installing, then connect to https://foldustory.com/agent. If already installed, preserve the existing configuration and discover available functions first. I will sign in with my Creator account and authorize my own test work in the browser. Then edit as requested, check the preview, and save to the cloud.

Package version **1.1.0**. Nested mechanism creation is being enabled for selected test accounts and works. Discover functions for the selected work first. Existing connectors and basic editing continue to work.

Install Node.js 22+ and Codex CLI, download or clone this repository, then run `node install.mjs --dry-run` followed by `node install.mjs`. Reopen Codex and ask: **“Use $foldustory to connect to my FoldUStory space.”**

Open the returned link, sign in to your Creator account, and explicitly select your own cloud works. Keep the page visible. Ask Codex to edit a selected work, review the preview, and save. A confirmed cloud revision is required before treating a save as complete. Revoke access from the authorization page. Never paste passwords, verification codes or access tokens into chat.
