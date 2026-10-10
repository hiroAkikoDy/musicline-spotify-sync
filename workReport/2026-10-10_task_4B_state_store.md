<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: state,tdd,node,immutability,phase4 -->
### 完了報告：Task 4B: state.json（処理済み・月別プレイリストID）の管理
実施日時：2026-10-10（JST）
目標：処理済みエピソード・追加済み曲・月別プレイリストID・未マッチ曲を `data/state.json` に
保存する純粋な管理モジュールを red/green TDD で実装する（通信なし・セキュリティ分類A）。

## 変更ファイル一覧
| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/sync/state.js | 新規。`loadState` / `saveState` / `setPlaylist` / `getPlaylist` / `recordTracks` / `hasTrack` / `markEpisode` / `isEpisodeProcessed` / `recordUnmatched` / `initialState` | 1-133 |
| test/sync/state.test.js | 新規テスト（先に作成=Red）15件。**日本語リテラルは全て \uXXXX エスケープの純ASCIIファイル**（下記エラー#2参照） | 1-240 |
| .gitignore | `data/state.json` を追加（タスクが許可した唯一の変更。追加前は `git check-ignore` で未カバーを確認） | 12行目 |

Task boundary順守: `src/spotify/**`, `src/index.js`, `src/sync/plan.js` ほか既存ファイルは未変更。
依存追加なし（node標準のみ）。`makeTrackKey` は `src/nhk/normalize.js` から import して使用
（recordTracks が key を省略された場合に `makeTrackKey(title, artist)` で計算）。

## 実装の要点
- スキーマ version 1（`playlists` / `tracks`(キー=makeTrackKey) / `episodes` / `unmatched` / `updatedAt`）
- `loadState`: 無ければ初期状態。**壊れたJSON・未知versionは例外**（メッセージにパスと「手動で確認」の
  案内を含める）でファイルは絶対に上書きしない（テストでファイル不変を検証）。version 正なら
  欠落フィールドは既定値で補完
- `saveState`: 一時ファイル→rename の原子的書き込み。`updatedAt` 更新。一時ファイル残留なしをテスト
- 更新関数は全て純粋（スプレッドで新しい state を返す・入力不変をテストで検証）
- `recordTracks`: 先勝ち（同一 makeTrackKey は上書きしない）。key 省略時は makeTrackKey(title, artist)。
  `month` は `YYYY-MM` 厳密形式（`2026-13`・`2026-9` を拒否）
- `recordUnmatched`: 同一 `episodeId+title+artist` は重複して積まない（再投入でも増えないことをテスト）

## 発生したエラーと対処
| # | エラー内容 | 原因 | 対処法 |
|---|---|---|---|
| 1 | Red フェーズ: `ERR_MODULE_NOT_FOUND`（src/sync/state.js） | 実装前（TDDの期待どおりの失敗） | Green で実装し解消 |
| 2 | **テストファイルの日本語が文字化けし SyntaxError**（「メッセージ」→「メチE��ージ」等・U+FFFD混入） | テスト内の `.state` 除去を **PowerShell の `Get-Content -Raw \| Set-Content` パイプライン**で行ったため、既定エンコード(ANSI/Shift-JIS)経由で UTF-8 日本語が破損 | テストファイル全体を **\uXXXX エスケープのみの純ASCII** で書き直し（`node -e` で `U+FFFD` 混入なし・`手動` 含むことを書き出し前後に検証）。**教訓: PowerShell でソースファイルの文字コード変換を含む書き換えをしてはいけない。置換が必要ならスクリプト側（node）で読み書きする** |
| 3 | recordTracks 系3テスト失敗（hasTrack false / save→load往復失敗） | 実装が `recordTracks` の戻り値を `{ state, added }` にしていた（仕様は「新しい state を返す」） | 実装を仕様どおり state 直返しに修正（テストは変更せず） |

## Git操作
- コミットメッセージ：feat(4B): state.json管理モジュール (load/save・純粋更新関数・15テスト)
- コミットID：（下記参照）
- ブランチ：feat/4b-state-store（main から作成済みのものを使用）
- push状況：push 済み
- CIステータス：グリーン（PR実行）
- PR: （下記参照・マージは未実施）

## 動作確認結果
**Red（実装前）:**
```
✖ test\sync\state.test.js
  'test failed'
（ERR_MODULE_NOT_FOUND: Cannot find module '...\msync-wt-4b\src\sync\state.js'）
```

**Green（実装後・worktreeルートで node --test）:**
```
ℹ tests 163
ℹ suites 35
ℹ pass 163
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11465.9329
```
新規15件の内訳: loadState 5（ファイル無し=初期状態/正常読込/壊れたJSON=例外かつファイル不変/
未知version=例外かつ不変/欠落フィールド補完）/ saveState 3（save→load往復・updatedAt更新/
原子的書き込みでtmp残留なし/親ディレクトリ自動作成）/ 更新関数 7（イミュータブル/月形式不正の例外/
recordTracks先勝ち+makeTrackKey表記ゆらぎ吸収/key省略時のmakeTrackKey計算/month不正・uri欠落の例外/
markEpisode/recordUnmatched重複排除）。

**通信:** 本タスクは通信なし（全てモック/一時ファイル。実Spotify・実NHK に未接触）。

## 完了条件チェック
- [x] `node --test` 全件通過（163/163・Red/Green ログ貼付）
- [x] テストを弱める変更なし（assert追加のみ。#2/#3 はテストファイル破損の修復と実装の仕様適合）
- [x] 壊れた state.json は例外かつ上書きしない（ファイル不変をテストで検証）
- [x] 更新関数は入力を破壊しない（各テストで入力の deepEqual を検証）
- [x] makeTrackKey は src/nhk/normalize.js から import（key省略時の計算に使用）
- [x] `data/state.json` を .gitignore に追加（許可された変更のみ・check-ignore で未カバー確認後に追加）
- [x] コミット → push → PR作成（--body-file）→ CIグリーン確認・**マージはしない**
- [x] Work_Report 作成（分類A・「動作確認結果」に未実施を残さない）

## 車検結果（受け入れ基準と照合）
├── CIグリーン：○（PR実行）
├── node --test：全163件通過 ○
├── セキュリティ（分類A）：○（シークレット扱いなし・通信なし）
├── 型アノテーション：○
└── テストを弱める変更なし：○（#2 はファイル破損修復、#3 は実装を仕様に合わせる修正。assert 未削除）

## セキュリティ確認（分類A）
├── 外部APIへの意図しない送信：なし（通信なし）
├── ハードコードされたシークレット：なし（state.json は曲・プレイリストIDのみ。トークンは保存しない設計）
└── 入力値のバリデーション：実装済み（month形式・version・name必須・uri必須・entry型チェック）

## 学習ポイント・次のステップへの展望
- **PowerShell の `Get-Content`/`Set-Content` は既定エンコード(ANSI)で UTF-8 日本語を破壊する**。
  ソースファイルの機械的な置換は必ず node スクリプト側で read/write すること（1B/3Bの
  `node -e` 引用符問題と並ぶ PowerShell 落とし穴）
- テストファイルは日本語リテラルを `\uXXXX` エスケープした純ASCIIにすると、エディタ/パイプライン
  の文字コード事故に強い（state.js 実装側は UTF-8 のまま運用）
- `recordTracks` を先勝ち+makeTrackKey 設計にしたことで、4C では「検索→採用→state反映」を
  冪等に再実行できる（再実行時の二重追加は ensureNotAlreadyAdded + hasTrack の二重防壁）
- チャンク失敗時の例外 `added`（4A）と state保存を組み合わせ、中断からの再開を 4C で実装する

## 起点
起点：計画/Phase4-4B/採用

## Claudeへの質問・相談事項
1. テストファイルの純ASCII化（\uXXXX エスケープ）は可読性と引き換えに安全性を取った判断です。
   今後のテストでも同じ方針（日本語はエスケープ）で統一してよいか、ご指示ください
