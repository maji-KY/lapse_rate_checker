// 初期設定の段階の仮の入口。取得・計算・描画は次の段階で lapse-report（Python 版）から移植する。
const app = document.querySelector<HTMLElement>("#app");
if (app !== null) {
  app.textContent = "気温減率チェッカー（準備中）";
}
