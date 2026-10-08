import { fetchAllEpisodes } from "./nhk/client.js";

async function main() {
  const [cmd] = process.argv.slice(2);
  if (cmd === "fetch") {
    const s = await fetchAllEpisodes();
    console.log("--- 集計 (data/episodes.json) ---");
    console.log(`総数: ${s.totalCount}`);
    console.log(`曲ありの回数: ${s.withMusic}`);
    console.log(`空の回数: ${s.emptyList}`);
    console.log(`フィールドなしの回数: ${s.noField}`);
    console.log(`総曲数: ${s.totalTracks}`);
    return;
  }
  console.error(`未実装: ${cmd ?? "(コマンドを指定してください)"} — 利用可能: fetch`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
