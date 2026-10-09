<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: spotify,playlist,api,tdd,node,phase4 -->
### 完了報告：Task 4A: Spotify プレイリスト API ラッパ（モックのみ・実機書き込みなし）
実施日時：2026-10-10（JST）
目標：プレイリスト作成・全URI取得・分割追加・重複除外の純粋ラッパを red/green TDD で実装する。
このTaskでは Spotify への実際の書き込みを行わない（実機作成・追加は Task 4C でユーザー確認のうえ実施）。

## 事前調査（公式ドキュメントの裏取り）
実施日: 2026-10-10。WebFetch で以下を確認。

| ドキュメント | URL | 実装に影響する要点 |
|---|---|---|
| Create Playlist | developer.spotify.com/documentation/web-api/reference/create-playlist | **`POST /me/playlists`**。Body は JSON: `name` (必須), `public` (既定 true), `collaborative`, `description`。応答 201 でプレイリストオブジェクト（`id`, `uri`, `snapshot_id` 等）。スコープ: playlist-modify-public / playlist-modify-private |
| February 2026 Dev Mode Changes | .../tutorials/february-2026-migration-guide | **`POST /users/{user_id}/playlists` は削除済み**（代替: `POST /me/playlists`）。プレイリスト系は `/tracks` → `/items` に改名。**フィールド改名: `tracks`→`items`, `tracks.tracks`→`items.items`, `tracks.tracks.track`→`items.items.item`**。items は自分がオーナー/共同編集者のプレイリストでのみ返る。Dev Mode: Premium必須・5ユーザーまで |
| Add Items to Playlist | .../reference/add-items-to-playlist | **`POST /playlists/{playlist_id}/items`**。Body JSON: `{ uris: [...], position? }`。**1リクエスト最大100件**。応答 201: `{ snapshot_id }`。旧 add-tracks-to-playlist は Deprecated |
| Get Playlist Items | .../reference/get-playlists-items | **`GET /playlists/{playlist_id}/items`**。**limit 既定20・最大50**（Range 0-50）・offset でページング。応答はページングオブジェクト `{ items[], next, total }`。**アイテムは `items[].item`（`items[].track` は Deprecated 互換）**。自分がオーナー/共同編集者でない場合は 403 |

### 前提との照合結果
- タスク前提「`/playlists/{id}/tracks` → `/items` は既知」→ 一致 ✓
- 「作成エンドポイントが Feb 2026 で変更されている可能性」→ **変更されていた**: `POST /users/{user_id}/playlists` は削除され `POST /me/playlists` が唯一の方法。`POST /me/playlists` を採用（食い違いではないが重要な確定事項）
- 「追加は100件上限」→ 一致 ✓（Body JSON の uris。クエリパラメータより Body 推奨と明記あり）
- 「取得 limit 上限とページング・`items[].item.uri` か `items[].track.uri` か」→ **limit 最大は50**（100ではない点に注意）。ページングは `next` URL。`item` が正式名・`track` は Deprecated 互換 → **両方に対応して実装**
- Dev Mode: プレイリスト操作への直接影響なし（Premium必須・ユーザー5人は運用上問題なし）

## 変更ファイル一覧
| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/spotify/playlist.js | 新規。`createPlaylist` / `listPlaylistUris` / `addTrackUris` / `ensureNotAlreadyAdded` | 1-93 |
| test/spotify/playlist.test.js | 新規テスト（先に作成=Red）13件 | 1-129 |

Task boundary順守: `src/spotify/client.js` ほか既存ファイルは未変更。`spotifyFetch` は引数で受け取る設計。
依存追加なし。

## 発生したエラーと対処
| # | エラー内容 | 原因 | 対処法 |
|---|---|---|---|
| 1 | Red フェーズ: `ERR_MODULE_NOT_FOUND`（src/spotify/playlist.js） | 実装前（TDDの期待どおりの失敗） | Green で実装し解消 |

（実装後のテスト実行は1回で全件通過。テスト・実装の往復による修正は発生せず）

## Git操作
- コミットメッセージ：feat(4A): プレイリストAPIラッパ (create/list/add/ensure・モック13テスト)
- コミットID：（下記参照）
- ブランチ：feat/4a-playlist-api（main から作成済みのものを使用）
- push状況：push 済み
- CIステータス：グリーン（PR実行）
- PR: （下記参照・マージは未実施）

## 動作確認結果
**Red（実装前）:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'...\msync-wt-4a\src\spotify\playlist.js' imported from
'...\msync-wt-4a\test\spotify\playlist.test.js'
```

**Green（実装後・worktreeルートで node --test）:**
```
ℹ tests 161
ℹ suites 36
ℹ pass 161
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11735.8602
```
新規13件の内訳: createPlaylist 3（パス/メソッド/ボディ・既定非公開・公開指定とname検証）/
listPlaylistUris 4（複数ページnext辿り+limit=50・nullやuri無し・item:nullを無視・0件・next空で無限ループしない）/
addTrackUris 5（0件で呼ばない・100件=1チャンク・101件=2・250件=3・入力内重複除去先勝ち・2チャンク目失敗時に
例外へ追加済み件数100を保持）/ ensureNotAlreadyAdded 1（完全重複・部分重複・順序保持）。

**Spotifyへの書き込み系リクエストを実際に発行していないことの明記:**
本タスクの通信はすべてテスト内のモック（spyFetch）であり、**実機で Spotify への書き込み系リクエスト
（POST /me/playlists, POST /playlists/{id}/items）を発行していない**。実機での作成・追加は Task 4C で
ユーザー確認のうえ実施する。

## 完了条件チェック
- [x] 事前調査を Work_Report 冒頭に記録（URL・要点・差異）。前提と食い違いなし（作成エンドポイントの確定は「変更されている可能性」の確認どおり）
- [x] `node --test` 全件通過（161/161・Red/Green ログ貼付）
- [x] テストを弱める変更なし（assert追加のみ・skip/削除/閾値緩和なし）
- [x] Spotifyへの実機書き込みなし（明記済み）
- [x] Task boundary 外は未変更（`createSpotifyClient` を返す `spotifyFetch` を引数で受け取る設計）
- [x] コミット → push → PR作成（--body-file）→ CIグリーン確認・**マージはしない**
- [x] Work_Report 作成（分類B・「動作確認結果」に未実施を残さない）

## 車検結果（受け入れ基準と照合）
├── CIグリーン：○（PR実行）
├── node --test：全161件通過 ○
├── セキュリティ（分類B）：○（モックのみ・トークン扱いなし）
├── 型アノテーション：○
└── テストを弱める変更なし：○

## セキュリティ確認（分類B）
├── 外部APIへの意図しない送信：なし（テストはモックのみ。実装は Spotify API への通信のみを意図）
├── ハードコードされたシークレット：なし（トークンを扱わない設計。Bearer は client.js が付与）
└── 入力値のバリデーション：実装済み（name必須チェック・urisの型チェック・chunkSizeの
    上限100クランプ・uri null/空の除外）

## 学習ポイント・次のステップへの展望
- Feb 2026 で作成エンドポイントが `POST /me/playlists` に一本化された（旧 /users/{id}/playlists 削除）。
  取得 limit は最大50（追加は100）と非対称なので、listPlaylistUris はページング必須
- 追加の中断対策として、チャンク失敗時の例外に `added`（追加済み件数）を持たせた。4C では
  state.json の保存と組み合わせて再実行時の二重追加を防げる（4B と連携）
- items[].item（新）と items[].track（旧互換）の両方を見る実装にしたため、Spotify側の応答の
  移行期間中も動作する

## 起点
起点：判例/3C-採点ルール変更/却下

## Claudeへの質問・相談事項
1. 実機でのプレイリスト作成・追加は Task 4C（ユーザー確認のうえ）と理解しています。プレイリスト名の
   命名規則（例: 「ミュージックライン 2026-09」）は 4C 前にご指定ください
