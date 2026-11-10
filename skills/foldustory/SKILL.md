---
name: foldustory
description: 通过网页登录授权连接 FoldUStory 个人空间，让 Creator 用自然语言编辑本人选定的云作品、检查立体书和纸样开合、同步网页预览并保存。用于 foldustory.com 授权作品，不用于未授权作品、模板抓取或批量导出。
---

# FoldUStory 创作连接器

通过 MCP 服务 `foldustory` 调用文档函数。只支持服务端允许的 Scene、PaperPattern 函数；制作草稿只可读上下文和改名。不要承诺整个工作台都可自动操作。

## 连接

1. 调用 `foldustory_space_connect {}`，给用户返回的授权网址和用户码。用户在固定的 `https://foldustory.com/agent` 登录 Creator，核对客户端并勾选本人的云作品后批准。不要读取浏览器会话、索取密码/验证码/令牌或替用户扩大范围。
2. 用户批准后调用 `foldustory_space_status {}`；仍待批准就等待用户操作。凭证仅保留在连接器内存，不写入聊天、配置或文件。
3. 调用 `foldustory_space_projects {}`，只选择用户明确指定的作品；同名时确认目标，不默认第一份。
4. 用新 requestId 调用 `foldustory_space_open {projectId,requestId}`。保持授权页打开且可见，预览在该网页运行，无需本地网站。

## 编辑与验证

使用 `foldustory_space_command {projectId,requestId,command}`。先读 describe-tools、get-context，再按需查询组件、连接面、原型、纸样顶点/折痕/胶区和固定来源。以实际返回的 ID 和参数定义为准，不猜测。

修改携带最近的 expectedRevision。冲突时重新读取并判断，不盲重试相对移动、复制或胶接。Scene 与 PaperPattern 不能混用，solver frame 为只读结果。胶接先查连接面并预览，再提交，检查 goalReached。

修改后检查错误、上下文、验证结果和网页实际预览；涉及结构要实际合上再展开。排队不等于执行成功。薄纸模拟不能证明实体可制作性或自由翻片的唯一运动。保留完整原图、轮廓与模板元数据。

若 describe-tools 返回统一创作函数：先用 describe-mechanism 读实际图层树和参数，用 get-assembly-surface 查询宿主生成的面、折线与默认参数；先 preview-stage-item 再 attach-stage-item。不要把新的面或折线臆造为独立书页。用 set-mechanism-parameter 调参，用 solve-mechanism 采样开合；检查父机关改变后子机关跟随、连接关系保留。浏览器与 Skill 共用撤销历史，不维护第二份本地模型。当前新增函数仅对指定账号和作品开放，未返回时按原有函数范围工作，不绕过服务端限制。

## 保存与撤销

- `foldustory_space_save {projectId,requestId}` 显式保存，以服务端确认和云版本为完成依据。编辑副本、本机保存、排队均不等于云备份完成。
- 每个逻辑操作固定一个 requestId。超时、断网或 unknown 时先用 foldustory_space_status 对账。提交响应丢失且没有 jobId 时，只能用原 requestId 和完全相同参数重查，不能新建 ID 重放。
- expired 或已派发未确认的操作可能执行过。先查作品与云版本。保存失败、冲突或不可读时保留原件和编辑副本，不能用空白文档覆盖。
- 授权约一小时有效，同时受当前 Creator 身份、登录会话和短期浏览器租约限制。失效后回网页重新确认，不找旧凭证。token_already_issued 时让用户撤销对应授权后重连。
- `foldustory_space_disconnect {}` 尝试远端撤销并清除内存。只有 revoked:true 表示服务器已撤销，否则请用户在 /agent 授权记录中撤销。退出进程不等于远端撤销。

仅连接固定正式域名。不要换域名、爬模板库、读未授权作品或发布到社区。首次验证使用用户明确同意的新测试作品，不修改已有作品。
