# 第一版技術決策

- **TypeScript + browser App Runtime**：同一套自有資料語意可在目前 Windows 與未來 WebView host 重用。輸入不經跨 runtime roundtrip；不用為第一版先建完整 native wrapper。
- **CodeMirror 6**：成熟的 selection、history、composition、viewport 支援；自有 adapter 實作同區 Live Preview。實際大量 clipboard paste、背景 runtime update、undo/redo 與 navigation 已納入瀏覽器測試。[官方來源](https://github.com/codemirror/view)。
- **SQLite / Node 24 node:sqlite**：本機 transactional、單一 portable database，無雲端帳號／服務。`node:sqlite` 在目前 Node 24 仍屬非穩定 API，僅封裝在 store adapter；SQLite 格式與 Grasp 資料語意不依赖該 API。[Node 文件](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)。
- **自有窄字串語法 + 增量 dependency graph**：需求只有 string、formatted string 與 reference；無 eval、loops、side effects。先用正確的 affected graph 演算法，實測後沒有引入 native calculation 的必要。
- **Web Worker**：將 parse/calculate 與輸入執行緒分開；可取消 superseded work，revision 拒絕晚到結果。連續取消時會重新建 worker/cache，屬已知成本。
- **Vite / Vitest / Playwright**：產出靜態 browser bundle 與無外部 production package 依賴的 Node host；測試包含真實 Edge 與真正 host restart。原始空 .NET solution 沒有必須繼承的實作。

MIT 授權的 CodeMirror/Lezer 等第三方程式保留於產物 notices。套件版本由 package-lock 鎖定；不把依賴自動升級當作一般啟動步驟。

Provisional：editor rendering 風格、Node host、SQLite adapter、目前 value grammar。使用者可以依手感局部替換；穩定的是 Note-first、DB authority、reference 語意與 controlled exchange。
