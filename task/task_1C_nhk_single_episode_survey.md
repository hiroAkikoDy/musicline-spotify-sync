# Task 1C: 過去回の選曲取得方法の調査（読み取り専用）

- ブランチ: 作らない（コードは変更しない）。調査用スクリプトは `scripts/survey_single.js` のみ新規可
- セキュリティ分類: A
- **着手条件**: 1A-fix または 1B のどちらかが完了していること（WIP制限2）

## 背景
一覧API（`.../radioepisode/pl/series-rep-Z9WGYY3GP5.json`）で `musicList` を持つのは直近28回（2026-09-08〜）のみで、
残り1634回（2020-01-20〜2026-09-07）は `detailedRecentEvent.misc` 自体が存在しない。`data/episodes.json` で確認済み。
単体取得API `https://api.nhk.jp/r8/t/radioepisode/re/{id}.json` に過去回の `musicList` があるかを調べる。

## 調査内容（実装はしない）
1. `data/episodes.json` から、年代を散らして **3〜5件** の id を選ぶ（例: 2020 / 2022 / 2024 / 2026-08 / 2026-09-07）
2. 各 id を単体取得APIで GET（**リクエスト間1秒以上**、合計5リクエスト以内、読み取りのみ）
3. 各回について記録: HTTPステータス、`musicList` の有無と件数、ある場合は先頭1曲の構造、
   無い場合は曲情報になりうるフィールド（`description`, `citation`, `hasPart`, `detailedPinnedCitation` 等）の有無と抜粋
4. 一覧と単体で `musicList` の有無が食い違う回があるか
5. 結論を3択で整理: (A) 単体APIで過去回も取れる／(B) 取れない（直近約1ヶ月のみ運用が現実的）／(C) 別の取得元が必要

## 制約
- 結果は `out/survey_single.json` に保存（`out/` は ignore 済み）。同じidを再取得しない
- 「存在しない」と結論する場合は、取得した全レスポンスに対する全文検索（`musicList` `byArtist` 等）の結果を添える（第7条）
- 想定外の結果でも、仕様を黙って解釈し直さず**そのまま報告**する。方針決定はユーザーが行う

## 完了条件
- 上記 1〜5 の表と結論を Work_Report（`workReport/2026-10-xx_task_1C_survey.md`）に記載
- 「起点」欄: `起点：計画/Phase1-1C/採用`
- 取得したのは何件・何リクエストかを明記
