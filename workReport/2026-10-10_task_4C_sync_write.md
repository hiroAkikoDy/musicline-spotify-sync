<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: sync,write,playlist,state,phase4 -->
### 完了報告：Task 4C: sync の書き込み実装（初めて実プレイリストを変更する）
実施日時：2026-10-10（JST）
目標：`sync` の書き込みモードを実装し、段階的な実機検証（dry-run → --limit 3 → 冪等確認 → 拡大）を
ユーザーの承認を得ながら実施する。採点ルール・閾値(60)は変更しない。削除系APIは使わない。

## 現在の状態：**段階2（実機書き込み --limit 3）のユーザー承認待ちで停止中**
- 実装とユニットテストは完了（184/184 通過・CIグリーン）
- 段階1（`sync --dry-run --limit 3`）実施済み・結果は下記
- **次の再開条件**: ユーザーが「実行してよい」と承認したら、段階2
  `node src/index.js sync --limit 3` を実行する（作成されるのは最大1つのプレイリスト
  「ミュージックライン 2026-10」・9曲・非公開）

## 変更ファイル一覧
| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/sync/apply.js | 新規。`applySync`: 処理済み回の除外→plan→追加済み曲の検索スキップ→runMatch→月ごとに(作成→list→追加→list再読)→state段階保存→markEpisode/recordUnmatched | 1-208 |
| src/index.js | `sync` 書き込みモード実装（`--yes` 追加）。確認プロンプト[ y/N]は書き込み直前の1回のみ。`--dry-run` と `fetch` の挙動は無変更 | 28-34(--yes), 57-131(runSync), 133-155(printWriteSummary/writeConfirm) |
| test/sync/apply.test.js | 新規テスト（先に作成=Red）8件 | 1-265 |
| test/sync/cli.test.js | 旧テスト1件更新: 「書き込み未実装」エラーの検証 → 4Cで書き込みモード実装済みのため、前提チェックへ進むことを検証する内容に変更（assert追加: 未実装メッセージが出ないこと） | 17-33 |

Task boundary順守: `src/nhk/**`, `src/match/**`, `src/spotify/**`, `src/sync/plan.js` `runMatch.js`
`report.js` `state.js` は未変更（`git diff main..HEAD --stat` で上記4ファイルのみ確認済み）。
依存追加なし。採点ルール・閾値(60)は変更していない。

## 事前確認（着手条件）
- 4A (PR #6)・4B (PR #7) とも main マージ済み（`git log` で確認）
- ベースライン: `node --test` **176/176 通過**（main で実行・全緑。報告の「約177」の実数は 148+13+15=176）
- 4C worktree に .env・data/episodes.json・data/spotify_token.json のコピー配置済み

## 実装の要点（レビュー追記を反映）
- **`addTrackUris` の `added` から追加済み曲を推測しない**: 追加失敗時は `listPlaylistUris` で
  実際のプレイリスト内容を読み直し、存在する曲だけを `recordTracks` して state 保存してから再スロー
- 成功時も追加後に list を読み直し、実際にプレイリストへ入った曲（＝Spotify側の真実）だけを
  state に記録する（state が失われても再検索が止まる）
- プレイリスト作成直後に `saveState`（中断に強い）・月ごと・失敗時にも保存
- 確認プロンプトは書き込み直前の1回のみ（マッチング自体は読み取りのみ）。`--yes` で省略
- プレイリスト名: `ミュージックライン YYYY-MM`・**非公開**（public: false）。削除系APIは不使用
- 月をまたぐ重複曲は最初の出現月にのみ追加（plan の既存挙動どおり）

## 発生したエラーと対処
| # | エラー内容 | 原因 | 対処法 |
|---|---|---|---|
| 1 | Red フェーズ: `ERR_MODULE_NOT_FOUND`（src/sync/apply.js） | 実装前（TDDの期待どおりの失敗） | Green で実装し解消 |
| 2 | 旧CLIテスト失敗: 「書き込み未実装」の検証が 4C 実装により obsolete | 3C のテストが旧挙動（未実装エラー）を期待 | テストを新挙動向けに更新（前提チェックへ進むこと・未実装メッセージが出ないことの assert 追加） |
| 3 | apply テスト: `errors is not defined` | applySync の月ループの catch で未宣言の変数を参照 | `writeErrors` 配列を宣言して summary.errors に設定 |
| 4 | apply テスト: 呼び出し順の期待値不一致 | 実装は追加後に list を再読み込みする（真実はSpotify側）設計。テスト期待値が旧順のまま | テスト期待値を `create→list→add→list` に更新（実装は意図どおり） |
| 5 | apply テスト: 一部で spotifyFetch 未指定→runMatch が全曲エラー＋実際の500msスリープで60秒超 | テストの依存渡し漏れ | `baseOpts` に spotifyFetch/sleepImpl を集約し全テストへ適用 |
| 6 | 途中失敗テスト: 追加が50ではなく20件 | テストフィクスチャの10月分日付に未来日(10-10以降)が含まれ、buildPlan の未来日除外（正しい挙動）で除外されていた | フィクスチャの日付を過去日に修正（実装は変更せず） |

## Git操作
- コミットメッセージ：feat(4C): sync書き込みモード (applySync・段階的state保存・実機は承認後に実施)
- コミットID：（下記参照）
- ブランチ：feat/4c-sync-write
- push状況：push 済み
- CIステータス：グリーン（PR実行）
- PR: （下記参照・マージは未実施）

## 動作確認結果
**Red（実装前）:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'...\msync-wt-4c\src\sync\apply.js' imported from '...\test\sync\apply.test.js'
```

**Green（実装後・worktreeルートで node --test）:**
```
ℹ tests 184
ℹ suites 40
ℹ pass 184
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12188.6259
```
新規8件の内訳: 初回の作成→list→追加→list順とstate保存 / 再実行で冪等(作成・追加・検索0) /
state空でもSpotify側が全曲持てば重複追加なし・state記録のみ / 途中失敗でSpotify真実を読み直し
state保存→再実行で残り50曲だけ追加 / 月2つで別プレイリスト+月跨ぎ重複は1回 / confirm n で
書き込み系不呼び出し+state未書込 / --yes で confirm 不呼び出し / 検索はGETのみ(DELETE無し)。

**実機 段階1: `node src/index.js sync --dry-run --limit 3`（読み取りのみ・書き込みなし）:**
```
対象: 3回 / 9曲 (テーマ曲除外 3件, 重複除外 0件, minScore=60) で検索します...
--- 月別 ---  2026-10: 9曲
検索対象: 9曲 / マッチ: 9曲 / 未マッチ: 0曲 / エラー: 0曲 / マッチ率: 100.0%
採用内訳: exact×none×within 3件 / exact×partial×within 4件 / exact×exact×within 2件
アーティスト点0採用: すばらしい日々(UNICORN) / 超最強・大盛りハッピー(Cho Tokimeki Sendenbu) の3件
閾値比較: 50点以上 9件 / 60点以上 9件 / 70点以上 6件
```
→ 書き込みを実行した場合の計画: **新規作成「ミュージックライン 2026-10」（非公開）への追加 9曲**
（月は 2026-10 のみ・作成プレイリストは1つ = 上限2つ以内）

**実機 段階2以降（--limit 3 の書き込み → 目視確認 → 冪等再実行 → --limit 20 → 全件）: 未実施。**
**ユーザー操作待ちで停止中**（上記「現在の状態」参照。承認後に実施し、結果を本節へ追記する）。

**トークン非出力の照合:** data/spotify_token.json の access_token / refresh_token の実値および
client_id が、実行出力・out/*.csv・本レポートに含まれないことを文字列照合で確認（含まれない）。
data/state.json もトークンを含まない設計（曲URI・プレイリストIDのみ）。

## 完了条件チェック
- [x] 着手条件: 4A/4B マージ済み・`node --test` 全件通過（176/176）
- [x] 事前に task_4C_sync_write.md を読み内容に従う
- [x] red/green TDD（Red ログ貼付）・ユニットテストはモックのみ（実Spotify・実NHK 未通信）
- [x] テストを弱める変更なし（旧CLIテストは4C仕様への更新で assert は追加）
- [x] 削除系API不使用（テストで検証）
- [x] Task boundary 外は未変更（採点ルール・閾値60は変更なし）
- [x] 完了条件1: node --test 全件通過
- [ ] 完了条件2: 実機書き込みの段階的実施 → **段階1完了・段階2の承認待ちで停止中**
- [x] トークンが出力・CSV・Work_Report・state.json に含まれない（実値照合）
- [ ] 完了条件5: コミット→push→PR→CI（コードは完了・**実機検証完了後に最終化**）
- [x] Work_Report 作成（停止中の旨と再開条件を明記）

## 車検結果（受け入れ基準と照合）
├── CIグリーン：○（PR実行）
├── node --test：全184件通過 ○
├── セキュリティ（分類B）：○（書き込みは state 保持のプレイリストIDのみ・非公開・削除系なし）
├── 型アノテーション：○
└── テストを弱める変更なし：○

## セキュリティ確認（分類B）
├── トークンの出力・ログ・state.json への混入：なし（実値照合済み）
├── ユーザーの他のプレイリストへの接触：なし（書き込み先は state が持つID・自分で作成したIDのみ）
├── 削除系API（DELETE）：不使用（テストで検証）
└── 入力値のバリデーション：実装済み（--yes/--since/--limit/--min-score・確認プロンプト[ y/N]）

## 学習ポイント・次のステップへの展望
- 「真実はSpotify側」原則により、追加失敗時・成功時のどちらも list 再読み込み結果を state に反映する
  設計にした。`added` は数えない（レビュー指示どおり）
- 途中失敗テストで未来日のフィクスチャが buildPlan の未来日除外（正しい挙動）に引っかかり、
  実追加件数が期待とずれた。フィクスチャは常に実行日基準で過去日を使う
- Phase 4C 完了後の運用: 週次で `fetch` → `sync`（state の増分により新規分のみ追加）が想定動作

## 起点
起点：計画/Phase4-4C/採用

## Claudeへの質問・相談事項
1. 段階2（`node src/index.js sync --limit 3` の実機書き込み）の承認をお願いします
   （作成されるのは「ミュージックライン 2026-10」の1プレイリスト・9曲・非公開）
