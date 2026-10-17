@echo off
chcp 65001 >nul
rem ============================================================
rem  一键推送到 GitHub
rem  ------------------------------------------------------------
rem  运行前请确认：
rem    1. 已在 GitHub 上建好空仓库 qigai74/Fusion-Project（Public）
rem    2. 仓库里**没有**勾选 README / .gitignore / license
rem  ------------------------------------------------------------
rem  这个脚本只做三件事：
rem    ① 配好 git 身份（你可以在下面两行改成自己的名字邮箱）
rem    ② 检查远程仓库是否存在
rem    ③ 推送
rem ============================================================

cd /d "%~dp0"

echo.
echo ============================================
echo   推送 聚变计划 · 圆方战记 到 GitHub
echo ============================================
echo.

rem ---- ① 身份（改这两行即可）----
set GIT_NAME=聚变计划
set GIT_EMAIL=qigai74@users.noreply.github.com

git config user.name "%GIT_NAME%"
git config user.email "%GIT_EMAIL%"
echo [1/3] 已设置提交身份：%GIT_NAME% ^<%GIT_EMAIL%^>
echo.

rem ---- ② 确认远程 ----
git remote set-url origin https://github.com/qigai74/Fusion-Project.git 2>nul
git remote add origin https://github.com/qigai74/Fusion-Project.git 2>nul
echo [2/3] 远程仓库：https://github.com/qigai74/Fusion-Project.git
echo.

rem ---- ③ 推送 ----
echo [3/3] 开始推送...
echo.
echo   >>> 如果弹出浏览器，请用 qigai74 登录并授权 <<<
echo   >>> 如果提示输入密码，请填 Personal Access Token <<<
echo        （不是登录密码；生成地址：github.com/settings/tokens）
echo.
git push -u origin main

if %ERRORLEVEL% EQU 0 (
  echo.
  echo ============================================
  echo   推送成功！
  echo   打开：https://github.com/qigai74/Fusion-Project
  echo ============================================
) else (
  echo.
  echo ============================================
  echo   推送失败。常见原因：
  echo     - 仓库还没建：先去 GitHub 建一个空的 Fusion-Project
  echo     - 认证失败：密码要用 Personal Access Token
  echo     - 网络：换个时段或用手机热点
  echo   把上面的报错整段发给 AI，它会帮你判断。
  echo ============================================
)

echo.
pause
