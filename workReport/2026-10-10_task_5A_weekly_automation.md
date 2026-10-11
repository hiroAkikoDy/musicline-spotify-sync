<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: weekly-automation,scheduled-task,bat,powershell,phase5 -->
### 完了報告：Task 5A: 週次の自動実行とワンクリック実行
実施日時：2026-10-10（JST）
目標：毎週土曜9:00の自動実行（タスクスケジューラ）とワンクリック実行（sync_now.bat）を実装する。
無人実行の安全装置（--max-add 50）、ログ/last_run.txt、二重起動防止、古いログの自動削除、
再認証案内を含む。**タスクスケジューラへの登録は実施せず、ユーザー承認待ちで停止。**

## 現在の状態：**実装完了・PR #9 作成済み。実機確認とタスク登録はユーザー承認待ちで停止中**
- 実装とユニットテスト完了（201/201 通過・CIグリーン）
- **次の再開条件（完了条件2・main への反映後に実施。各段階で承認を取る）**:
  1. メインフォルダで `node scripts/weekly_sync.js` を1回実行（新着が無ければ追加0件の想定）→
     ログと `last_run.txt` を表示
  2. `--max-add` の動作はユニットテストで確認済み（超過で書き込み系不呼び出し/終了コード2）
  3. `register_weekly_task.ps1` の登録可否を確認（登録内容: タスク名 `MusiclineSpotifySync`・
     毎週土曜 9:00・実行 `weekly_sync.bat <node絶対パス>`・上限1時間。表示して承認を取ってから登録）
  4. 登録後 `Start-ScheduledTask` で手動起動し `last_run.txt` 更新を確認
  5. `-DesktopShortcut` のショートカット作成も確認後に実施

## 変更ファイル一覧
| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/ops/weekly.js | 新規。`runWeekly`(fetch→sync実行・ログ・last_run・ロック・ログ整理)/`acquireLock`/`releaseLock`/`isLockStale`/`cleanupOldLogs`/`pickFailureGuidance`/`buildLastRunText`/`jstTimestamp`/`jstDateTime`/`resolveRoot` | 1-168 |
| scripts/weekly_sync.js | 新規。週次同期の呼び出し口（スクリプト位置からルート解決・終了コード伝播） | 1-8 |
| scripts/sync_now.bat | 新規。ワンクリック実行（chcp 65001・fetch→dry-run→sync・最後までウィンドウ開放） | 1-19 |
| scripts/weekly_sync.bat | 新規。スケジューラ用起動口（ルート移動・node絶対パスを第1引数で受領・終了コード伝播） | 1-10 |
| scripts/register_weekly_task.ps1 | 新規。タスク登録/解除/ショートカット作成（-Day/-Time/-Remove/-DesktopShortcut/-PrintPlan/-Yes・UTF-8 BOM付き） | 1-97 |
| src/index.js | `--max-add N` オプション追加（解析とバリデーション・超過時は終了コード2） | 37, 54-57, 143-147 |
| src/sync/apply.js | `--max-add` の安全装置（追加予定が上限超過なら1曲も書き込まず exceeded で復帰） | 103-118 |
| test/sync/apply.test.js | テスト3件追加（超過で書き込み系不呼び出し/上限ちょうど/不正値は例外） | 345-392 |
| test/sync/cli.test.js | テスト1件追加（--max-add 不正値は CLI でエラー終了）※boundary 記載外だが新オプション検証に必要のため追加（後述の相談事項2） | 35-50 |
| test/ops/weekly.test.js | 新規テスト12件（成功/失敗/案内分岐/ロック/古いロック/ログ整理/ユーティリティ） | 1-247 |
| README.md | 「7-5. 運用」節を追加（自動実行・sync_now・ログ・再認証・登録解除） | 7-4 表の直後 |
| .gitignore | `logs/` と `data/weekly.lock` を追加 | 7, 12 |

Task boundary順守: `src/nhk/**`, `src/match/**`, `src/spotify/**`, `src/sync/plan.js` `runMatch.js`
`report.js` `state.js` は未変更。依存追加なし。
※ `.gitignore` は指示書の「logs/ の追加のみ」に加え `data/weekly.lock` を追加した（完了条件4が
「logs/ と data/weekly.lock はコミットしない」を要求するため。意図の解釈違いであれば指摘してほしい）。

## 実装の要点
- **`--max-add N`**: `applySync` がマッチング後・書き込み前に追加予定の合計を判定し、上限超過なら
  **1曲も書き込まず**（作成も追加もstate保存もしない）`exceeded: true` で復帰。CLI は終了コード2で
  理由を表示。不正値（負数・非整数）は例外
- **二重起動防止**: `data/weekly.lock`（pid と開始時刻）。6時間以内のロックがあれば終了コード3で
  スキップ。古いロックは無視して上書き。終了時（成功・失敗問わず finally）に必ず削除
- **ログ**: `logs/weekly_YYYY-MM-DD_HHmmss.log`（JST名・fetch と sync の出力を統合・各ステップ後に
  フラッシュ）＋ `logs/last_run.txt`（成功/失敗・JST日時・追加曲数・未マッチ数・失敗理由）
- **ログ整理**: 60日より古い `weekly_*.log` を実行の最後に削除（last_run.txt は削除しない）
- **案内分岐**: 失敗メッセージに `invalid_grant` / `refresh_token` / 再認証 を含む場合は
  「`node scripts/auth_check.js` で再認証してください」、それ以外は
  「次回の実行で自動的に再試行されます（state は途中まで保存済み）」
- **weekly_sync.bat は node の絶対パスを第1引数で受ける**: `register_weekly_task.ps1` が
  `Get-Command node` で解決した絶対パスを渡して登録する（PATH 依存で動かさない）
- **タスク登録の設定**: StartWhenAvailable（電源オフで時刻を逃したら起動後すぐ実行）・
  ユーザーログオン中に実行・バッテリー駆動でも実行・実行時間上限1時間・タスク名 `MusiclineSpotifySync`
- **register_weekly_task.ps1 は UTF-8 BOM 付き**で保存（PowerShell 5.1 が日本語を正しく解釈するため）。
  構文解析・BOM・日本語文字化けの3点を検証済み（PARSE OK / BOM OK / JAPANESE TEXT OK）
- **sync_now.bat / weekly_sync.bat は ASCII のみ**で記述（cmd のコードページ問題を回避）。
  日本語表示は node 側が出力する（chcp 65001 済み）

## 発生したエラーと対処
| # | エラー内容 | 原因 | 対処法 |
|---|---|---|---|
| 1 | Red フェーズ: `ERR_MODULE_NOT_FOUND`（src/ops/weekly.js）+ --max-add テスト3件失敗 | 実装前（TDDの期待どおりの失敗） | Green で実装し解消 |
| 2 | テスト: `mkdir is not defined` | weekly.test.js の import に `mkdir` が抜けていた | import を修正 |
| 3 | runWeekly が成功時も code 1 を返す / 案内分岐が効かない | **テストの spawnImpl を async 関数にしていた**（Promise を返し、実装の同期契約 `spawnSync` 相当と不一致 → `r.status` が undefined） | モックを同期関数に修正（実装ではなくモックの契約ミス） |
| 4 | resolveRoot のテスト失敗（`'C:\\' !== 'C:/proj'`） | 実装が「必ず2階層上」を返す作りで、scripts/（1階層）からの呼び出しに対応していなかった＋テストが実在しないパスを使っていた | 実装を `package.json` を辿る方式に変更し、テストも実ツリー（package.json を作成）で検証するように修正 |
| 5 | register_weekly_task.ps1 の検証スクリプトで「JAPANESE TEXT BROKEN」 | **検証用 .ps1 自体が BOM 無し**で、PowerShell 5.1 が日本語リテラルを ANSI として解釈した | 検証スクリプトを純ASCII（charコード構築）に修正。ターゲットの ps1 は BOM 付きで正しいことを確認 |
| 6 | **CI（ubuntu）で resolveRoot のテストのみ失敗**（`'//tmp/...' !== '/tmp/...'`） | テスト内の URL 構築が `"file:///" + パス` という Windows 前提の文字列結合で、POSIX では4スラッシュになり fileURLToPath の結果が `//tmp/...` になっていた | テストの URL 構築を `pathToFileURL(p).href` に変更（クロスプラットフォーム）。実装は変更せず |

## Git操作
- コミットメッセージ：feat(5A): 週次自動実行とワンクリック実行 (weekly.js・--max-add・bat/ps1・16テスト)
- コミットID：6f73df2（実装）+ 636be96（CI の Linux 失敗修正）
- ブランチ：feat/5a-weekly-automation
- push状況：push 済み
- CIステータス：グリーン（PR実行）
- PR: **#1**（現在のリポジトリでの番号・マージは未実施）

## 動作確認結果
**Red（実装前）:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\msync-wt-5a\src\ops\weekly.js'
（--max-add テスト3件も失敗: exceeded/期待メッセージが未実装のため）
```

**Green（実装後・worktreeルートで node --test）:**
```
ℹ tests 201
ℹ suites 42
ℹ pass 201
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13084.3184
```
新規16件の内訳: runWeekly 7（成功時のログ/last_run/ロック解除・fetch失敗でsync不実行・
invalid_grant案内・max-add超過で終了コード2・二重起動で3・古いロック無視・60日ログ整理）/
ユーティリティ 5（resolveRoot・jstTimestamp・isLockStale・pickFailureGuidance・cleanupOldLogs対象外保護）/
max-add 3（超過で書き込み系不呼び出し/ちょうど一致/不正値例外）/ CLI 1（--max-add 不正値でエラー終了）。

**register_weekly_task.ps1 の検証（登録は実行していない）:**
```
-PrintPlan の実行結果:
タスク名      : MusiclineSpotifySync
スケジュール  : 毎週 Saturday 09:00 (時刻を逃した場合は起動後すぐに実行)
実行コマンド  : <worktree>\scripts\weekly_sync.bat <node絶対パス>
作業ディレクトリ: <worktree>
実行時間の上限: 1時間 / バッテリー駆動でも実行
検証: PARSE OK / BOM OK (UTF-8 with BOM) / JAPANESE TEXT OK (no mojibake)
```

**実機 段階1〜5（weekly_sync.js の実行・タスク登録・ショートカット作成）: 未実施。**
**ユーザー承認待ちで停止中。** 再開条件は上記「現在の状態」のとおり（main への反映後に、
メインフォルダで weekly_sync.js を1回実行 → last_run.txt 表示 → タスク登録の承認 → 登録 →
手動起動で last_run.txt 更新確認 → ショートカット作成）。実施後に本節へ追記する。

**トークン非出力の設計と確認:** weekly_sync.js は子プロセスの出力（トークンを含まない）をログに
書くのみで、トークン値そのものを扱わない（トークンは index.js 内の tokenStore がファイルから読む）。
実機実行後、ログ・last_run.txt とトークン実値の文字列照合を実施して本節に追記する。

## 完了条件チェック
- [x] 着手条件: PR #8 マージ済み・main で sync 1回実行済み（追加0件）・`node --test` 185件通過
- [x] 完了条件1: `node --test` 全件通過（Red/Green ログ貼付・201/201）
- [ ] 完了条件2: 実機確認 → **ユーザー承認待ちで停止中**（再開条件は「現在の状態」に明記）
- [x] 完了条件3: トークン非出力の設計（実機ログとの実値照合は実機確認時に実施して追記）
- [x] 完了条件4: `logs/` と `data/weekly.lock` をコミットしない（.gitignore 追加済み・git status で未追跡を確認）
- [x] 完了条件5: コミット→push→PR作成（--body-file）→CIグリーン（マージはしない）
- [x] 完了条件6: Work_Report 作成（停止中の旨と再開条件を明記）
- [x] 完了条件7: PowerShell 5.1 前提・`&&` 不使用
- [x] タスクスケジューラへの登録は実施していない（承認待ち）
- [x] 学習メモ: リポジトリの再作成に伴い PR 番号が #1 から振り直しになったため、
  以降の記録では PR 番号を「現在のリポジトリでの番号」として扱う

## 車検結果（受け入れ基準と照合）
├── CIグリーン：○（PR実行）
├── node --test：全201件通過 ○
├── セキュリティ（分類B）：○（無人実行の上限50曲・ロック・トークン非出力の設計）
├── 型アノテーション：○
└── テストを弱める変更なし：○（失敗はモック契約と実装バグの修正。assert追加のみ）

## セキュリティ確認（分類B）
├── トークンの出力・ログ・last_run.txt への混入：設計上なし（子プロセス出力はトークンを含まない。
│   実機確認時に実値照合を実施予定）
├── タスクスケジューラへの登録：**未実施**（ユーザー承認待ち。登録内容は -PrintPlan で表示可能）
├── ユーザーの他のプレイリストへの接触：なし（既存設計どおり state 保持のIDのみ）
└── 入力値のバリデーション：実装済み（--max-add 整数≥0・不明オプション拒否・ロックの古さ判定）

## 学習ポイント・次のステップへの展望
- Windows タスクスケジューラの「時刻を逃したら起動後すぐ実行」は schtasks.exe では設定できず、
  PowerShell の `New-ScheduledTaskSettingsSet -StartWhenAvailable` を使う
- .bat は UTF-8 日本語を避けて ASCII で書き、日本語表示は node 側に任せる（chcp 65001 済み）
  ことで cmd のコードページ問題を回避
- spawnSync 相当の同期モックを使うことで、子プロセス実行のテストが高速かつ決定的になった
- Phase 5A 完了後の運用フロー: （自動）土曜9:00 fetch→sync（上限50曲）→ logs/last_run.txt 確認 →
  （手動）sync_now.bat で即時同期

## 起点
起点：計画/Phase5-5A/採用

## Claudeへの質問・相談事項
1. **実機確認（完了条件2）の開始承認をお願いします**: PR #8 …ではなく PR #9（本タスク）をマージ後、
   メインフォルダで以下を順に実施します（各段階でご報告します）:
   ① `node scripts/weekly_sync.js`（1回実行・ログと last_run.txt を表示）
   ② `--max-add` の確認（ユニットテスト結果の提示・実機では超過を再現しない）
   ③ タスク登録の承認（`-PrintPlan` の内容を提示 → 承認後に登録）
   ④ `Start-ScheduledTask` で手動起動 → last_run.txt 更新確認
   ⑤ `-DesktopShortcut` でショートカット作成（作成前に確認）
2. `--limit` の新しい解釈（新しい順N回・処理済みを含む選択）は 4C の段階4冪等確認と整合するように
   修正しました。週次運用（limit 無し=全未処理対象）には影響ありません
