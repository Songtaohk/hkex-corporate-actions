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
