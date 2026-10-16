# GitHub Pages 404 排查说明

## 当前情况

- GitHub 用户名：ZalanDZ
- 访问地址：https://zalandz.github.io/kz/
- 当前返回：404，There isn't a GitHub Pages site here.
- 公开 API 无法访问 zalandz/kz，说明仓库可能是私有仓库，或者仓库名不是 kz。

## 仅部署静态页面时的处理步骤

1. 在 GitHub 打开仓库，进入 Settings。
2. 进入 Pages。
3. Build and deployment 选择 Deploy from a branch。
4. Branch 选择 main，目录选择 / (root)。
5. 保存后等待 1-3 分钟。
6. 打开仓库的 Actions 页面，确认 Pages 构建成功。
7. 确认 index.html 位于仓库根目录，而不是上传到了多层子文件夹中。
8. 如果仓库名不是 kz，访问地址应为：https://ZalanDZ.github.io/仓库名/

本目录已经包含 .nojekyll 文件，可以避免 Jekyll 忽略部分静态文件。

## 重要限制

本网站的完整功能依赖 server.js 本地后台服务，包括：

- 写入 data/state.json
- 读取网站文件夹数据
- Excel / Word 文件解析
- 文件备份与自动恢复

GitHub Pages 只能托管静态 HTML、CSS、JavaScript，不能运行 Node.js 后台服务，也不能写入服务器文件夹。因此即使 Pages 不再显示 404，完整功能仍然无法在 GitHub Pages 上正常运行。

## 完整功能部署建议

如需远程使用完整功能，应部署到支持 Node.js 和持久化磁盘的平台，例如：

- Windows VPS 或 Linux VPS
- Render 搭配 Persistent Disk
- Railway 搭配 Volume
- 其他支持 Node.js 和持久文件存储的服务器

如果只需要展示页面，可以制作一个仅用于 GitHub Pages 的静态版本，但库存和导入数据只能保存在浏览器中，不能写入网站文件夹。
