# GitHub 上传教程（零基础版）

写给「几乎一窍不通」的情况。跟着做就行，每步都有验证方法。

---

## 0. 先搞清楚 GitHub 是什么

用一句话说：

> **GitHub 是一个"代码的网盘 + 展示柜"。**

- **网盘**：把项目文件存上去，换电脑也能拿回来，改坏了能回退
- **展示柜**：别人能看见、能下载、能提意见（Issues）

三个容易混的词：

| 词 | 大白话 |
|---|---|
| **Git** | 装在**你电脑上**的工具，负责"记录每次改动" |
| **GitHub** | **网站**，负责"存放这些记录" |
| **仓库 (Repository)** | 一个项目的文件夹，GitHub 上叫 "repo" |

所以你需要的流程是：
`本机用 Git 记录` → `推到 GitHub 上` → `别人在网页上看/下载`

---

## 1. 注册 GitHub 账号

1. 打开 https://github.com/signup
2. 填邮箱、密码、用户名
   - **用户名会出现在网址里**（`github.com/你的名字`），想好再定
   - 建议用英文/数字，不要用中文
3. 验证邮箱

> ⚠️ 中国访问 GitHub 有时不稳定。如果打不开，可以试试：
> - 换个时段（深夜/清晨通常好）
> - 用手机热点
> - 长期方案：找个稳定的网络环境

---

## 2. 告诉 Git "你是谁"

**这一步必须先做**，否则后面提交会报错。

在 PowerShell 里跑（把名字和邮箱换成你自己的）：

```powershell
git config --global user.name "你的名字"
git config --global user.email "你的邮箱@example.com"
```

> 邮箱建议用 GitHub 注册时那个。
> 如果不想暴露真实邮箱，GitHub 设置里有个
> "Keep my email addresses private"，会给一个 `xxx@users.noreply.github.com`，
> 用那个也行。

**验证**：

```powershell
git config --global user.name
git config --global user.email
```

能打印出你填的内容就对了。

---

## 3. 在 GitHub 上建一个空仓库

1. 登录后点右上角 **「+」→ New repository**
2. 填写：
   - **Repository name**：`fusion-arena`（或你喜欢的英文名）
   - **Description**：`聚变计划 · 圆方战记 — 自动战斗模拟器`
   - **Public**（公开）← 你说了要开源自由玩，选这个
   - ⚠️ **不要**勾 "Add a README file"、不要选 .gitignore、不要选 license
     （因为你本地已经有了，勾了会冲突）
3. 点 **Create repository**

创建完会看到一个空页面，上面有几行命令 —— 先别管，看下一步。

---

## 4. 把本地项目推上去

`cd` 到你的项目目录，然后依次跑这几条：

```powershell
cd "C:\Users\35565\Documents\deepseek-harness\default-workspace\球球小作战"

# ① 把自己介绍给仓库（先做，避免提交报错）
git config user.name "你的名字"
git config user.email "你的邮箱@example.com"

# ② 记下"我要存的远程地址"（把 你的用户名 换掉）
git remote add origin https://github.com/你的用户名/fusion-arena.git

# ③ 把当前状态记成一个"存档点"
git add -A
git commit -m "首次提交：聚变计划 · 圆方战记 v1.0.0"

# ④ 改名为主分支（GitHub 现在默认叫 main）
git branch -M main

# ⑤ 推上去
git push -u origin main
```

**第 ⑤ 步会弹窗要你登录**：
- 会跳出浏览器让你授权 GitHub，点同意即可
- 如果没弹窗、而是要账号密码：**密码要填 Personal Access Token**，不是登录密码
  - 去 https://github.com/settings/tokens 生成一个（选 `repo` 权限）
  - 生成后**只显示一次**，复制下来当密码用

**验证**：刷新 GitHub 仓库页面，应该能看到你的文件了。

---

## 5. 以后每次改动怎么存

养成固定三步：

```powershell
cd "C:\Users\35565\Documents\deepseek-harness\default-workspace\球球小作战"

git add -A                              # 把改动加入待提交
git commit -m "改了什么（一句话）"        # 记一个存档点
git push                                # 推到 GitHub
```

**就这么简单。** 前两条在本机做，第三条上传。

> 提交信息写清楚点，将来回头看能知道每次改了什么。
> 比如：`修复翻窗时速度没下降的问题`、`新增预算模式的地图选择`。

---

## 6. 常用命令（背下来就够用了）

```powershell
git status              # 现在有哪些改动（最常用，随时看）
git log --oneline -10   # 最近 10 次提交记录
git diff                # 具体改了哪些行
git restore 文件名       # 放弃某个文件的改动（改坏了救命用）
```

---

## 7. 发一个"Release"（让别人能直接下载游戏）

你的游戏是单文件，很适合发 Release：

1. 仓库页面右侧点 **Releases → Create a new release**
2. **Choose a tag**：填 `v1.0.0` → 点 "Create new tag"
3. **Release title**：`v1.0.0 首个公开版本`
4. **Description**：简单写玩法
5. **Attach binaries**：把 `发布/圆方战记.html` 拖进去
6. 点 **Publish release**

这样就有了一个固定下载链接，可以直接贴给别人。

---

## 8. 收到别人提交的地图怎么办

你说了想做玩家社群地图上传。最轻的流程：

1. 让玩家在游戏里点「生成分享码」，把那段字符串贴到
   **Issues**（仓库页面的 Issues 标签 → New issue）
2. 你看到后，在游戏里「导入分享码」→ 载入 → 存进 `maps/` 目录
3. 提交上去

后期如果投稿多了，可以做成自动的（我给你写个脚本从 Issues 抓）。

---

## 9. 我（AI）能帮你做什么

你可以直接说：

- 「帮我提交并推送」← 我跑 git 命令，你只需要在弹出的窗口里登录
- 「我忘了 git 命令」← 我随时告诉你
- 「这个报错什么意思」← 把报错贴给我
- 「帮我发 Release」← 我准备好文件，你点几下

**唯一需要你自己做的是**：注册账号、网页上的点击、以及第一次登录授权。

---

## 附：常见报错速查

| 报错 | 原因 | 怎么办 |
|---|---|---|
| `please tell me who you are` | 没配身份 | 跑第 2 节的命令 |
| `remote origin already exists` | 已经加过远程了 | `git remote set-url origin 新地址` |
| `failed to push some refs` | 远程有你本地没有的东西 | `git pull --rebase` 再 push |
| `Authentication failed` | 密码用了登录密码 | 用 Personal Access Token |
| `LF will be replaced by CRLF` | Windows 换行符警告 | **无害，忽略**（已加 .gitattributes 减少） |
| 推送时卡住不动 | 网络问题 | 换网络/时段，或配置代理 |
