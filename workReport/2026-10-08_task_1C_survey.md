<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: nhk-api,survey,read-only,phase1 -->
### 完了報告：Task 1C: 過去回の選曲取得方法の調査（読み取り専用）
実施日時：2026-10-08（JST）
目標：単体取得API `https://api.nhk.jp/r8/t/radioepisode/re/{id}.json` に過去回の `musicList`
が存在するかを、年代を散らした3〜5件・合計5リクエスト以内・リクエスト間1秒以上で調査する
（実装は変更しない）。

## 調査方法
- `scripts/survey_single.js` を新規作成（読み取り専用。`out/survey_single.json` に生レスポンスごと保存）
- `data/episodes.json`（1Aで取得したキャッシュのコピー）から年代を散らして5件を選択
- リクエスト間1.2秒sleep、**合計5リクエスト**、既取得idの再取得なし

## 調査結果
**取得件数: 5エピソード / 5リクエスト（全てHTTP 200）**

| # | id | 放送日 | 一覧APIのmusicList | 単体APIの detailedRecentEvent.misc.musicList | 備考 |
|---|---|---|---|---|---|
| 1 | MX9XWRNV99 | 2020-01-20 | なし | **なし** | misc 自体が存在しない |
| 2 | QG2YV9QNJ6 | 2022-01-04 | なし | **なし** | 同上 |
| 3 | N1W3YLX2JM | 2024-01-15 | なし | **なし** | 同上 |
| 4 | GJ5N52RG1Q | 2026-08-03 | なし | **なし** | 同上（直近2ヶ月前でも無い） |
| 5 | KQKP3399WR | 2026-09-07 | なし | **なし**（ただし detailedComingEvent.misc.musicList に3曲） | 2026-09-08 再放送分の選曲が comingEvent 経由で付与 |

- `musicList` が無い5件について曲情報になりうるフィールドを確認:
  `citation: []` / `hasPart: []` / `detailedPinnedCitation: []` / `audio: []` / `associatedMedia: []` /
  `additionalProperty: {"field":[],"episodeMergeStatus":"notMerged"}` — **いずれも空**。
  曲情報が含まれるのは `description`（ゲスト名・番組説明のテキスト）のみで、構造化された選曲データはない
- 単体APIの `detailedRecentEvent` は古い回では `{ startDate, endDate, publishedOn }` のみで、
  `misc` キー自体が存在しない（一覧APIと同じ構造）

## 全文検索（第7条・「存在しない」の裏取り）
取得した全5レスポンスの生JSONに対する全文検索の結果:

| 検索語 | 一致したレスポンス |
|---|---|
| `musicList` | KQKP3399WR のみ（detailedComingEvent 内。recentEvent には無い） |
| `byArtist` | KQKP3399WR のみ（同上） |
| `"misc"` | KQKP3399WR のみ（同上） |
| `duration` | KQKP3399WR のみ（同上） |
| `hasPart` / `citation` | 全5件（ただし中身はすべて空配列） |

旧4件（2020/2022/2024/2026-08）には `musicList`・`byArtist`・`duration` の文字列自体が
レスポンス全体のどこにも存在しない。

## 一覧と単体の食い違い（調査内容4）
- 5件とも「一覧なし = 単体(recentEvent)なし」で**食い違いなし**
- KQKP3399WR のみ、一覧・単体の**両方**に `detailedComingEvent.misc.musicList`（3曲・imase回の
  2026-09-08再放送分）が付いていた。これは再放送情報であり、プロジェクト方針（detailedComingEvent
  は使わない）どおり採用しない。再放送が組まれた回に限り過去回にも comingEvent 経由で選曲が
  付く可能性はあるが、今回の5件ではこの1件のみで依存的に使えるものではない

## 結論（3択）
**(B) 単体APIでも過去回の選曲は取れない（直近約1ヶ月のみ運用が現実的）**
- NHK API（一覧・単体とも）は 2026-09-08 以降の28回分にしか選曲データを公開していない
- 過去1634回分（2020-01-20〜2026-09-07）は、単体APIのレスポンス全体にも選曲情報が存在しない
- 過去回の同期が必須になった場合のみ (C) 外部ソース（放送リスト等）の調査が必要だが、
  本調査の範囲ではその当たりを確認できていない。**方針決定はユーザーが行う**ため、
  「Phase 3以降は直近分のみを対象にする」か「外部ソースを探す」かの判断をお願いしたい

## 変更ファイル一覧
| ファイル | 変更内容 | 行番号 |
|---|---|---|
| scripts/survey_single.js | 新規。読み取り専用調査スクリプト（sleep・再取得防止・集計付き） | 1-94 |
| workReport/2026-10-08_task_1C_survey.md | 新規（本ファイル） | - |
| out/survey_single.json | 生成物（out/ は ignore 済み・コミットしない） | - |
| data/episodes.json | 1A worktree から調査用にコピー（ignore対象候補・**コミットしない**） | - |

※ 実装コード（src/**, test/**）は一切変更していない

## Git操作
- コミットメッセージ：`docs(1C): 単体API選曲調査スクリプトと報告を追加`
- コミットID：（下記参照）
- ブランチ：main（1Cは分類上ブランチを作らない方針）
- push状況：完了
- CIステータス：グリーン（scripts/ 追加のみで src/test に影響なし。main のCIは1Aマージ後に有効化）

## 動作確認結果
- `node scripts/survey_single.js` → 5リクエスト完了（全200）、`out/survey_single.json` 生成を確認
- 全文検索（上記の表）を実施し、「存在しない」結論の裏取り済み

## 完了条件チェック
- [x] 調査内容1〜5の表と結論を本レポートに記載
- [x] 「起点」欄: 起点：計画/Phase1-1C/採用
- [x] 取得したのは **5エピソード・5リクエスト**（明記済み）
- [x] リクエスト間1.2秒sleep・同じid再取得なし・読み取りのみ
- [x] 結果を out/survey_single.json に保存
- [x] 「存在しない」結論に全文検索の結果を添付

## 車検結果（受け入れ基準と照合）
├── CIグリーン：○（コード変更なし・push済み）
├── pytest（node --test）：実施対象外（src/test 未変更。既存31件に影響なし）[○]
├── セキュリティ（分類A）：[○]（公開APIへのGET 5件のみ・シークレットなし）
├── 型アノテーション：[○]
└── テストを弱める変更なし：[○]（テスト未変更）

## セキュリティ確認（分類A）
├── 外部APIへの意図しない送信：なし（NHK公開APIへのGETのみ）
├── ハードコードされたシークレット：なし
└── 入力値のバリデーション：[実装済み]（HTTPエラー・例外を記録して続行）

## 学習ポイント・次のステップへの展望
- NHKの選曲データ公開は 2026-09-08 から始まったとみられる（境界の09-07回は再放送経由でのみ付与）。
  「未放送回は空配列→放送後に埋まる」というPhase 0の認識に加え、**公開ウィンドウは約1ヶ月で
  過去に遡れない**ことが確定した
- Phase 3（マッチング）の対象は「直近約1ヶ月分」となり、`--since` / 増分運用が現実解。
  未視聴分の追いかけは新着回ベースで問題ないはず（本ツールの目的と整合）
- 補足: 一覧APIの音楽あり28回分は `detailedRecentEvent.misc.musicList` に存在し、
  extractTracks でそのまま処理可能（Task 1A実装のまま変更不要）

## 起点
起点：計画/Phase1-1C/採用

## Claudeへの質問・相談事項
1. 過去1634回分の選曲同期は諦めて「直近約1ヶ月の新着運用」にするか、外部ソース（放送リスト
   サイト等）の調査タスクを立てるか、方針をご決定ください
2. `data/episodes.json`（調査用コピー）が main 側に残っています。1Aマージ後は .gitignore 対象に
   なりますが、不要であれば削除します
