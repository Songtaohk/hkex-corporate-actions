# 香港上市公司事項查詢工具

繁體中文網頁工具，用於查看未來三個月內香港 IPO、增發及分紅資料，並下載英文欄位的 Excel。

## 使用

先更新靜態資料：

```bash
npm run update-data
```

再啟動本機預覽：

```bash
npm run dev
```

打開 `http://localhost:3000`。

## 靜態資料模式

前端只讀取 `public/data/latest.json`，下載 Excel 時直接使用 `public/data/latest.xlsx`。頁面上的「刷新」只會重新讀取 `latest.json`，不會即時抓取港交所或其他官方網站。

官方資料抓取、PDF/HTML 解析、估算及 Excel 生成由後台腳本 `scripts/update-data.js` 負責：

```bash
npm run update-data
npm run build
```

專案不在前端放置 API key、token 或 secret。

## 可選：用戶觸發後台刷新

純 GitHub Pages 不能在用戶點擊時執行 `npm run update-data`，也不能按 IP 做 12 小時限制。若需要「用戶點擊刷新 -> 重新抓官方資料 -> 重新估算 -> 重新發布」，需要加一個小型後台。

本專案提供 Cloudflare Worker 範例：`workers/refresh-worker.js`。它會：

- 讀取訪問者 IP。
- 用 Cloudflare KV 記錄刷新時間，限制每個 IP 12 小時只能刷新一次。
- 觸發 GitHub Actions 的 `deploy-pages.yml`。
- 不在前端暴露 GitHub token。

設定概要：

1. 複製 `workers/wrangler.toml.example` 為 Cloudflare Worker 的 `wrangler.toml`。
2. 建立 Cloudflare KV namespace，並把 namespace id 填入 `wrangler.toml`。
3. 在 GitHub 建立一個只允許 Actions workflow dispatch 的 token。
4. 在 Cloudflare Worker Secret 中設定 `GITHUB_TOKEN`。
5. 部署 Worker，取得 Worker URL。
6. 在 GitHub repository `Settings -> Secrets and variables -> Actions -> Variables` 新增 `NEXT_PUBLIC_REFRESH_ENDPOINT`，值為 Worker URL。
7. 重新執行 GitHub Actions 部署。

配置後，頁面「刷新」會提交後台刷新請求；若同一 IP 12 小時內已刷新過，頁面會顯示下一次可刷新時間。

## GitHub Pages 發布

本專案已配置 GitHub Pages 自動部署流程：`.github/workflows/deploy-pages.yml`。

發布步驟：

1. 在 GitHub 建立一個新倉庫，例如 `hkex-corporate-actions`。
2. 把本專案推送到該倉庫的 `main` 分支。
3. 在 GitHub 倉庫頁面進入 `Settings` -> `Pages`。
4. `Build and deployment` 選擇 `GitHub Actions`。
5. 等待 Actions 完成後，網站地址通常是：

```text
https://<你的 GitHub 用戶名>.github.io/<倉庫名>/
```

每次推送到 `main` 時，GitHub Actions 會自動執行：

```bash
npm run update-data
npm run build
```

並把 `out/` 目錄發布成靜態網站。

## 驗證

```bash
npm test
npm run lint
npm run build
```

## 資料來源

- HKEXnews 新上市資料
- HKEXnews 分紅及其他權益
- HKEXnews 公告搜尋
- 香港金管局公開 API 目錄保留為官方來源註冊項

第一版只使用官方公開資料。官方未披露或 PDF 無法穩定抽取的欄位會顯示「未公布」；可由官方日期表推導的欄位會標註「按規則估算」。
