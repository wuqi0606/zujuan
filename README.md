# xuekewang

这一个**学科网（组卷网）试卷打印增强脚本**，帮助用户免费下载组卷和试卷、导出高质量 PDF，并完美支持数学公式渲染。

## 核心功能

- **免费下载试卷** — 支持从学科网/组卷网下载试卷资源
- **格式调整** — 自定义字体、字号、行距、页码样式等
- **PDF导出** — 支持导出精美的 PDF 文件，保留所有格式
- **公式支持** — 完美渲染数学公式
- **打印优化** — 浮动按钮快速打印，支持多种打印模式（仅试题、试题+答案、答案附末尾等）
- **去广告** — 自动移除页面广告

这是一个**油猴脚本**（Userscript），使用纯 JavaScript 编写，依赖 SweetAlert2 库来提供美观的对话框。

---

## 如何安装油猴脚本

### 第一步：安装油猴管理器

选择你的浏览器安装对应的油猴扩展：

- **Chrome/Edge/Brave** → [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobp55f)
- **Firefox** → [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- **Safari** → [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)

### 第二步：安装此脚本

1. 在油猴管理器中创建新脚本
2. 复制 `user.js` 的全部内容粘贴进去
3. 保存（Ctrl+S 或 Cmd+S）

### 第三步：验证安装

- 访问 https://zujuan.xkw.com 学科网
- 页面右下角会出现蓝色的 **"🖨️ 打印试卷"** 浮动按钮
- 点击按钮即可打开打印设置对话框

---

## 使用说明

1. 在学科网/组卷网上打开试卷
2. 点击右下角蓝色的 **"打印试卷"** 按钮
3. 在对话框中选择：
   - 试卷标题
   - 打印内容（仅试题/试题+答案/答案附末尾/仅答案）
   - 字体、字号、行距
   - 页码样式
4. 点击 **"开始打印"** 即可用浏览器打印功能导出 PDF 或打印

✨ **脚本会自动保存你的偏好设置**，下次使用会记住上次的配置。
