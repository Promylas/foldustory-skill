# 数据定义的自定义机关

只对 Creator 明确授权的本人作品操作；首次尝试使用新测试作品。先发现实际命令和 revision，所有写入及装配预览携带 expectedRevision。数据单位为 mm、deg；禁止提交代码、URL、世界坐标 frame 或伪造验证结果。

## 从零绘制纸样

在用户新建的空白纸样作品中调用 `create-paper {name, geometry, expectedRevision}`。

`geometry` 包含 `width,height,vertices:[{id,x,y}],edges:[{id,a,b,kind}]`。`kind` 可为 boundary、cut、mountain、valley、crease、flat。边引用实际顶点 ID。外轮廓和孔洞用闭合 boundary 环；共享折痕用一条内部边。不得用此命令覆盖已有作品。

`add-paper-sheet {geometry,expectedRevision}` 追加新的独立材料；在展开图空白位置绘制，使用独立顶点和边 ID，不切分或覆盖旧纸面。已有材料的轮廓修改用 reshape-pattern，增加折线或反折用 construct-paper。

从返回的 faces / list-faces 获取编译后的真实面 ID。通过 install-book 安装书页，按 list-connection-faces → preview-glue → glue-faces 的顺序连接；需同时闭合多个连接时使用 assemble-paper，先 preview:true 再以相同参数提交。临时固定不会自动释放。新增纸片本身不代表已经完成装配。

## 安装到立体书

Scene 使用 `preview-paper-mechanism` / `attach-paper-mechanism`，参数为 `id,name?,definition,mount?,expectedRevision`。

`definition` 是自己创作的结构数据：`{geometry,book:{pageWidth,pageHeight},glue,angles?}`。glue 为实际固定连接，包含 id、kind:"fixed-glue"、source/target:{panelId,face,region}；各胶区对应点必须全等并位于材料内。这里的 page-L/page-R 是机关的两个宿主接口。angles 仅作为预折分支，不是自定义动画；不确定运动仍须报告。

`mount` 为 `{creaseId,offset,heading?,face?}`。书脊 ID 为 spine；其他 ID 必须从当前作品的 get-assembly-surface 或 describe-item 读取。不要猜测父机关中心、凹谷或新折线 ID。第一阶段书脊安装只支持正面正向；父机关折线可选方向与正反面。偏移沿实际折线计算，胶区必须在宿主纸面内。

预览不修改作品。检查 validation 后使用同一请求提交。`describe-paper-mechanism {id}` 读取本人当前作品内该自定义机关的编辑定义；`update-paper-mechanism` 原子更新结构，不能丢失已有子机关、胶接或逐面图稿引用。结构不再兼容已有装配时应保留原件并报告失败。

安装后可在该机关的实际面或折线上继续安装其他组件。通过 simulate 检查合上、半开、展开、再次合上；验证父机关变动后子机关跟随。检查共享撤销和重新打开后的关系。保存使用 foldustory_space_save，并以服务端云版本确认为准。

## 范围

每份自定义结构最多 64 源顶点、96 源边、16 编译纸面、12 胶接；每个 Scene 最多 4 个自定义纸样机关。只运行平台求解器，不支持自定义 JS/TS/WASM。可达范围和薄纸采样通过不等于实体制作保证，也不证明运动唯一。此功能不增加模板读取或图纸/完整工程导出权限。
